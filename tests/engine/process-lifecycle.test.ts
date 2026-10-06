// Processo real (C5/A6 + C1/C2 da onda 1): o server.ts sobe, drena a caixa de entrada que ficou para trás, devolve à
// fila o job órfão do processo anterior, e no SIGTERM espera o prazo, devolve o job em andamento e sai limpo (código 0);
// a próxima subida envia a resposta UMA vez.
// Rodar: WA_MOCK=false node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/engine/process-lifecycle.test.ts
// Portas: app 127.0.0.1:3021, IA falsa 3022, Evolution falsa 3023. Telefones e textos inventados.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { ingestInboundMessage } from '../../src/server/messages/ingest'
import { storeInbox } from '../../src/server/whatsapp/inbox'
import { evoUpsert, startFakeEvolution } from '../_fakes/fake-evolution'
import type { FakeEvolution } from '../_fakes/fake-evolution'
import { lastUserText, startFakeLlm } from '../_fakes/fake-llm'
import type { FakeLlm } from '../_fakes/fake-llm'
import { cleanupBiz, convOf, createBiz, db, digits, isolateSchema, jidOf, jobsOf, newPhone, sleep, uid, waitFor } from '../_fakes/test-db'

const ROOT = path.resolve(__dirname, '..', '..')
const PORT = 3021
const KEY = 'chave-de-teste-evolution'
const SLOW = 'mensagem que demora'
let evo: FakeEvolution
let llm: FakeLlm
let child: ChildProcess | null = null
let logs = ''

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: String(PORT),
    HOSTNAME_BIND: '127.0.0.1',
    WA_MOCK: 'false',
    NEXT_PUBLIC_WA_MOCK: 'false',
    ENGINE_DISABLED: '',
    ENGINE_TICK_MS: '1000',
    SHUTDOWN_GRACE_MS: '3000',
    EVOLUTION_API_URL: evo.url,
    EVOLUTION_API_KEY: KEY,
    EVOLUTION_TIMEOUT_MS: '5000',
    OPENAI_BASE_URL: llm.url,
    OPENAI_API_KEY: 'chave-falsa-de-teste',
    ANTHROPIC_API_KEY: '',
    LLM_TIMEOUT_MS: '20000',
  }
}

async function startServer(): Promise<ChildProcess> {
  logs = ''
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const p = spawn(process.execPath, [tsx, path.join('tests', '_fakes', 'server-signals.ts')], { cwd: ROOT, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
  p.stdout?.on('data', (c) => (logs += String(c)))
  p.stderr?.on('data', (c) => (logs += String(c)))
  child = p
  await waitFor(async () => logs.includes('PearChat pronto em') || p.exitCode !== null, { timeoutMs: 180_000, everyMs: 500, what: 'servidor de teste subir' })
  assert.equal(p.exitCode, null, `servidor caiu na subida:\n${logs.slice(-2000)}`)
  return p
}

/** Envia "SIGTERM" ao processo (ver tests/_fakes/server-signals.ts) e espera ele sair. */
async function sigterm(p: ChildProcess): Promise<number | null> {
  const exited = new Promise<number | null>((r) => p.once('exit', (code) => r(code)))
  p.stdin?.write('SIGTERM\n')
  const code = await Promise.race([exited, sleep(30_000).then(() => -999)])
  child = null
  return code
}

function killTree(p: ChildProcess | null) {
  if (!p?.pid || p.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'])
  else p.kill('SIGKILL')
}

before(async () => {
  await isolateSchema()
  evo = await startFakeEvolution(3023)
  // A mensagem "lenta" segura o modelo por 8 s (mais que o prazo de desligamento de 3 s).
  llm = await startFakeLlm(3022, (req) => (lastUserText(req).includes(SLOW) ? { text: 'Resposta da lenta', delayMs: 8000 } : { text: 'Resposta rápida' }))
})
after(async () => {
  killTree(child)
  await cleanupBiz()
  await evo.close()
  await llm.close()
  await db.$disconnect()
})

describe('ciclo de vida do processo (server.ts real)', () => {
  it('subida drena a caixa de entrada, retoma o job órfão; SIGTERM devolve o job e sai limpo; a próxima subida envia uma vez', async () => {
    try {
      await scenario()
    } catch (e) {
      console.error(`---- log do servidor de teste (fim) ----
${logs.slice(-8000)}`)
      throw e
    }
  })
})

async function scenario() {
  {
    const { workspaceId, instance } = await createBiz()
    const p1 = newPhone()
    const p2 = newPhone()
    const p3 = newPhone()

    // 1) Evento gravado antes de uma queda (o 200 saiu, o processamento não): fica na caixa de entrada.
    await storeInbox('evolution', JSON.stringify(evoUpsert(instance, { remoteJid: jidOf(p1), message: { conversation: 'mensagem um' } })))
    // 2) Job "executando" de um processo que morreu no meio.
    await ingestInboundMessage({ workspaceId, from: { telefone: p2 }, body: 'mensagem dois', providerMessageId: `in-${uid()}`, timestamp: new Date() })
    const c2 = (await convOf(workspaceId, p2))!
    await db.aiJob.updateMany({ where: { conversationId: c2.id }, data: { status: 'executando', runAt: new Date(Date.now() - 60_000), attempts: 1 } })

    let server = await startServer()
    await waitFor(async () => (await convOf(workspaceId, p1)) !== null, { timeoutMs: 30_000, what: 'caixa de entrada drenada na subida' })
    await waitFor(async () => evo.deliveredTo(digits(p1)).length === 1, { timeoutMs: 60_000, what: 'resposta para a mensagem drenada' })
    await waitFor(async () => evo.deliveredTo(digits(p2)).length === 1, { timeoutMs: 60_000, what: 'resposta do job órfão' })
    assert.match(logs, /devolvido\(s\) à fila/)

    // 3) Mensagem que chega pelo webhook HTTP e cuja resposta ainda está sendo gerada quando chega o SIGTERM.
    const res = await fetch(`http://127.0.0.1:${PORT}/api/wa/evolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY },
      body: JSON.stringify(evoUpsert(instance, { remoteJid: jidOf(p3), message: { conversation: SLOW } })),
    })
    assert.equal(res.status, 200)
    await waitFor(async () => llm.reqs.some((r) => lastUserText(r).includes(SLOW)), { timeoutMs: 60_000, what: 'geração da resposta lenta começar' })
    const code = await sigterm(server)
    assert.equal(code, 0, `saída do SIGTERM:\n${logs.slice(-2000)}`)
    assert.match(logs, /"event":"motor-parado"[^\n]*"devolvidos":1/)
    assert.match(logs, /"event":"desligado"/)
    const c3 = (await convOf(workspaceId, p3))!
    assert.equal((await jobsOf(c3.id))[0]!.status, 'pendente', 'job devolvido à fila')
    await sleep(6000) // a geração lenta termina depois do desligamento: nada pode ter saído
    assert.equal(evo.deliveredTo(digits(p3)).length, 0)

    // 4) Próxima subida: o job devolvido roda e a resposta sai UMA vez.
    llm.set(() => ({ text: 'Resposta depois do reinício' }))
    server = await startServer()
    await waitFor(async () => evo.deliveredTo(digits(p3)).length >= 1, { timeoutMs: 60_000, what: 'resposta depois do reinício' })
    await sleep(4000)
    assert.equal(evo.deliveredTo(digits(p3)).length, 1)
    assert.equal(evo.deliveredTo(digits(p1)).length, 1)
    assert.equal(evo.deliveredTo(digits(p2)).length, 1)
    assert.equal(await sigterm(server), 0)
  }
}
