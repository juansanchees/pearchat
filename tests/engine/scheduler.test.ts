// Motor (C6 e C5/A6 da onda 1): concorrência limitada pelo connection_limit, tick que não se sobrepõe e desligamento
// gracioso (job em andamento termina ou volta para a fila SEM duplicar o envio).
// Rodar (a URL de teste tem connection_limit=2):
//   WA_MOCK=false node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/engine/scheduler.test.ts
// (IA falsa em 127.0.0.1:3022, Evolution falsa em 127.0.0.1:3023). Telefones e textos inventados.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { POST } from '../../src/app/api/wa/evolution/route'
import { runDueAiJobs } from '../../src/server/engine/ai-reply'
import { connectionLimit, engineLimiter, engineSlots, laneSlots, resetEngineLimiters, Semaphore, setEngineStopping } from '../../src/server/engine/limiter'
import { runGuardedTick, stopEngine, tickSkippedCount } from '../../src/server/engine/scheduler'
import { ingestInboundMessage } from '../../src/server/messages/ingest'
import { evoUpsert, startFakeEvolution } from '../_fakes/fake-evolution'
import type { FakeEvolution } from '../_fakes/fake-evolution'
import { startFakeLlm } from '../_fakes/fake-llm'
import type { FakeLlm } from '../_fakes/fake-llm'
import { cleanupBiz, convOf, createBiz, db, digits, isolateSchema, jidOf, jobsOf, makeDue, msgsOf, newPhone, sleep, uid, waitFor } from '../_fakes/test-db'

const KEY = 'chave-de-teste-evolution'
const REPLY = 'Certo, já verifico.'
let evo: FakeEvolution
let llm: FakeLlm

const inbound = (workspaceId: string, phone: string, body: string) =>
  ingestInboundMessage({ workspaceId, from: { telefone: phone }, nome: 'Cliente Teste', body, providerMessageId: `in-${uid()}`, timestamp: new Date() })

async function oneConversation() {
  const { workspaceId, instance } = await createBiz()
  const phone = newPhone()
  await inbound(workspaceId, phone, 'Olá')
  const conv = (await convOf(workspaceId, phone))!
  return { workspaceId, instance, phone, conv }
}

before(async () => {
  await isolateSchema()
  evo = await startFakeEvolution(3023)
  llm = await startFakeLlm(3022, () => ({ text: REPLY }))
  Object.assign(process.env, { EVOLUTION_API_URL: evo.url, EVOLUTION_API_KEY: KEY, EVOLUTION_TIMEOUT_MS: '5000', OPENAI_BASE_URL: llm.url, OPENAI_API_KEY: 'chave-falsa-de-teste', LLM_TIMEOUT_MS: '10000' })
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ENGINE_MAX_CONCURRENCY
})
after(async () => {
  setEngineStopping(false)
  await cleanupBiz()
  await evo.close()
  await llm.close()
  await db.$disconnect()
})
beforeEach(async () => {
  setEngineStopping(false)
  resetEngineLimiters()
  await db.aiJob.updateMany({ where: { status: { in: ['pendente', 'executando'] } }, data: { status: 'feito', error: 'limpo pelo teste' } })
  evo.reset()
  llm.reset()
  llm.set(() => ({ text: REPLY }))
})

describe('vagas do motor (connection_limit)', () => {
  it('lê o connection_limit da URL e divide as vagas entre IA e tarefas', () => {
    assert.equal(connectionLimit(process.env.DATABASE_URL), 2, 'o lançador de teste usa connection_limit=2')
    assert.deepEqual(laneSlots(), { ia: 1, tarefas: 1 })
    const at = (n: number) => connectionLimit(`postgresql://u:p@h:5432/d?schema=x&connection_limit=${n}`)
    assert.equal(at(8), 8)
    const saved = process.env.DATABASE_URL
    try {
      for (const [n, total] of [
        [2, 2],
        [3, 2],
        [5, 3],
        [8, 6],
        [20, 6],
      ] as const) {
        process.env.DATABASE_URL = `postgresql://u:p@h:5432/d?schema=x&connection_limit=${n}`
        assert.equal(engineSlots(), total, `connection_limit=${n}`)
        const l = laneSlots()
        assert.equal(l.ia + l.tarefas, total)
        assert.ok(l.ia >= 1 && l.tarefas >= 1)
      }
    } finally {
      process.env.DATABASE_URL = saved
    }
  })

  it('o semáforo nunca passa do máximo, mesmo com rajadas e liberações intercaladas', async () => {
    const s = new Semaphore(2)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 40 }, async (_, i) =>
        s.run(async () => {
          active++
          peak = Math.max(peak, active)
          await sleep(i % 3)
          active--
        }),
      ),
    )
    assert.equal(peak, 2)
    assert.equal(s.peak, 2)
    assert.equal(s.inUse, 0)
    assert.equal(s.waiting, 0)
  })

  it('com connection_limit=2 só UM job de IA roda por vez, mesmo com duas passadas simultâneas; nada falha por pool', async () => {
    const convs = await Promise.all([oneConversation(), oneConversation(), oneConversation()])
    const quiet = await createBiz({ enabled: false }) // recebe os webhooks simultâneos sem criar jobs de IA
    llm.set(() => ({ text: REPLY, delayMs: 400 }))
    for (const c of convs) await makeDue(c.workspaceId)
    // Duas passadas ao mesmo tempo (o agendador e a rota de desenvolvimento, por exemplo) + webhooks chegando.
    const posts = Array.from({ length: 3 }, () => POST(new Request('http://127.0.0.1/api/wa/evolution', { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify(evoUpsert(quiet.instance, { remoteJid: jidOf(newPhone()), message: { conversation: 'chegando' } })) })))
    const [a, b, ...statuses] = await Promise.all([runDueAiJobs(), runDueAiJobs(), ...posts])
    assert.equal(a + b, 3)
    assert.deepEqual(
      (statuses as Response[]).map((r) => r.status),
      [200, 200, 200],
    )
    assert.equal(llm.peak, 1, 'nunca dois pedidos ao modelo ao mesmo tempo')
    assert.equal(engineLimiter('ia').peak, 1)
    for (const c of convs) assert.equal(evo.deliveredTo(digits(c.phone)).length, 1)
  })
})

describe('tick', () => {
  it('um tick lento não se sobrepõe ao próximo (o segundo é pulado)', async () => {
    const { workspaceId, phone } = await oneConversation()
    llm.set(() => ({ text: REPLY, delayMs: 2500 }))
    await makeDue(workspaceId)
    const skipped = tickSkippedCount()
    const first = runGuardedTick()
    await waitFor(async () => llm.calls >= 1, { what: 'job em andamento' })
    const t0 = Date.now()
    await runGuardedTick()
    assert.ok(Date.now() - t0 < 1000, 'o segundo tick voltou na hora')
    assert.equal(tickSkippedCount(), skipped + 1)
    await first
    assert.equal(llm.calls, 1)
    assert.equal(evo.deliveredTo(digits(phone)).length, 1)
    assert.ok(engineLimiter('tarefas').peak <= 1)
  })
})

describe('desligamento gracioso (SIGTERM)', () => {
  it('job mais longo que o prazo: volta para a fila, não envia neste processo e o próximo envia UMA vez', async () => {
    const { workspaceId, conv, phone } = await oneConversation()
    llm.set(() => ({ text: REPLY, delayMs: 2500 }))
    await makeDue(workspaceId)
    const tick = runGuardedTick()
    await waitFor(async () => llm.calls >= 1, { what: 'job em andamento' })
    const r = await stopEngine(300)
    assert.equal(r.devolvidos, 1)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'pendente')
    await tick // a geração termina, mas o envio é cancelado (o job pertence ao próximo processo)
    assert.equal(evo.deliveredTo(digits(phone)).length, 0)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'pendente', 'o resultado do processo que desligou não vale')
    // "Próximo processo": o motor volta e executa o job uma única vez.
    setEngineStopping(false)
    llm.set(() => ({ text: REPLY }))
    await makeDue(workspaceId)
    await runDueAiJobs()
    assert.equal(evo.deliveredTo(digits(phone)).length, 1)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'feito')
    assert.equal((await msgsOf(conv.id)).filter((m) => m.direction === 'OUT').length, 1)
  })

  it('job dentro do prazo: o desligamento espera ele terminar (envia uma vez, nada devolvido)', async () => {
    const { workspaceId, conv, phone } = await oneConversation()
    llm.set(() => ({ text: REPLY, delayMs: 600 }))
    await makeDue(workspaceId)
    const tick = runGuardedTick()
    await waitFor(async () => llm.calls >= 1, { what: 'job em andamento' })
    const r = await stopEngine(20_000)
    await tick
    assert.equal(r.devolvidos, 0)
    assert.equal(evo.deliveredTo(digits(phone)).length, 1)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'feito')
    // Parado: nenhum tick novo começa.
    const skipped = tickSkippedCount()
    await runGuardedTick()
    assert.equal(tickSkippedCount(), skipped)
    assert.equal(llm.calls, 1)
  })
})
