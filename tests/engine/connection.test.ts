// Queda de conexão da Evolution (A3 da onda 1): um `close` passageiro só PAUSA as automações (derivado do status) e tudo
// volta sozinho ao reconectar; logout definitivo (401) desliga de verdade e avisa o dono.
// Rodar: WA_MOCK=false node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/engine/connection.test.ts
// (IA falsa em 127.0.0.1:3022, Evolution falsa em 127.0.0.1:3023). Telefones e textos inventados.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { POST } from '../../src/app/api/wa/evolution/route'
import { runDueAiJobs, sweepPending } from '../../src/server/engine/ai-reply'
import { ingestInboundMessage } from '../../src/server/messages/ingest'
import { drainInbox, storeInbox } from '../../src/server/whatsapp/inbox'
import { evoConnection, startFakeEvolution } from '../_fakes/fake-evolution'
import type { FakeEvolution } from '../_fakes/fake-evolution'
import { startFakeLlm } from '../_fakes/fake-llm'
import type { FakeLlm } from '../_fakes/fake-llm'
import { captureEvents, cleanupBiz, convOf, createBiz, db, digits, isolateSchema, jobsOf, makeDue, msgsOf, newPhone, sleep, uid } from '../_fakes/test-db'

const KEY = 'chave-de-teste-evolution'
let evo: FakeEvolution
let llm: FakeLlm
const events = captureEvents()

const postEvo = (body: unknown) =>
  POST(new Request('http://127.0.0.1/api/wa/evolution', { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify(body) }))

const inbound = (workspaceId: string, phone: string, body: string) =>
  ingestInboundMessage({ workspaceId, from: { telefone: phone }, nome: 'Cliente Teste', body, providerMessageId: `in-${uid()}`, timestamp: new Date() })

async function automations(workspaceId: string) {
  const [agent, fu, ws, session] = await Promise.all([
    db.aiAgent.findUnique({ where: { workspaceId } }),
    db.followUpRule.findUnique({ where: { workspaceId } }),
    db.workspace.findUnique({ where: { id: workspaceId } }),
    db.whatsAppSession.findUnique({ where: { workspaceId } }),
  ])
  return { ia: agent?.enabled, followUp: fu?.enabled, disparos: ws?.disparosAtivos, status: session?.status }
}

before(async () => {
  await isolateSchema()
  evo = await startFakeEvolution(3023)
  llm = await startFakeLlm(3022, () => ({ text: 'Claro! Posso ajudar.' }))
  Object.assign(process.env, { EVOLUTION_API_URL: evo.url, EVOLUTION_API_KEY: KEY, OPENAI_BASE_URL: llm.url, OPENAI_API_KEY: 'chave-falsa-de-teste', LLM_TIMEOUT_MS: '5000' })
  delete process.env.ANTHROPIC_API_KEY
})
after(async () => {
  await cleanupBiz()
  await evo.close()
  await llm.close()
  await db.$disconnect()
})
beforeEach(async () => {
  await db.aiJob.updateMany({ where: { status: { in: ['pendente', 'executando'] } }, data: { status: 'feito', error: 'limpo pelo teste' } })
  evo.reset()
  llm.reset()
  events.length = 0
})

describe('queda passageira x desconexão definitiva', () => {
  it('close momentâneo (428) e reconexão: automações continuam ligadas e a IA volta a responder sozinha', async () => {
    const { workspaceId, instance } = await createBiz({ followUp: true })
    const phone = newPhone()
    // Cliente escreveu; antes do job rodar, a conexão cai.
    await inbound(workspaceId, phone, 'Vocês abrem hoje?')
    const conv = (await convOf(workspaceId, phone))!
    assert.equal((await postEvo(evoConnection(instance, 'close', 428))).status, 200)
    assert.deepEqual(await automations(workspaceId), { ia: true, followUp: true, disparos: true, status: 'DESCONECTADO' })
    // O job roda durante a queda: não envia (pausado), sem gastar a mensagem.
    await makeDue(workspaceId)
    await runDueAiJobs()
    assert.equal(evo.delivered.length, 0)
    assert.match((await jobsOf(conv.id))[0]!.error ?? '', /WhatsApp desconectado/)

    // Reconecta: nada precisa ser religado.
    assert.equal((await postEvo(evoConnection(instance, 'open'))).status, 200)
    assert.deepEqual(await automations(workspaceId), { ia: true, followUp: true, disparos: true, status: 'CONECTADO' })
    // A varredura retoma a mensagem que ficou sem resposta durante a queda (ela só considera mensagens com mais de 6 s).
    const lastIn = (await msgsOf(conv.id)).at(-1)!
    await sleep(Math.max(0, lastIn.createdAt.getTime() + 6_500 - Date.now()))
    assert.ok((await sweepPending()) >= 1)
    await makeDue(workspaceId)
    await runDueAiJobs()
    assert.equal(evo.deliveredTo(digits(phone)).length, 1, 'respondida depois de reconectar')
    // E uma mensagem nova também é respondida.
    await inbound(workspaceId, phone, 'E amanhã?')
    await makeDue(workspaceId)
    await runDueAiJobs()
    assert.equal(evo.deliveredTo(digits(phone)).length, 2)
    assert.deepEqual(
      (await msgsOf(conv.id)).map((m) => m.direction),
      ['IN', 'OUT', 'IN', 'OUT'],
    )
  })

  it('close sem código (ou 408/515/440) também é passageiro', async () => {
    for (const reason of [undefined, 408, 515, 440]) {
      const { workspaceId, instance } = await createBiz({ followUp: true })
      await postEvo(evoConnection(instance, 'close', reason))
      assert.deepEqual(await automations(workspaceId), { ia: true, followUp: true, disparos: true, status: 'DESCONECTADO' }, `código ${reason}`)
    }
  })

  it('logout definitivo (401): desliga IA, follow-up e disparos, registra na auditoria e avisa a equipe', async () => {
    const { workspaceId, instance } = await createBiz({ followUp: true })
    const org = await db.organization.create({ data: { nome: 'Org Teste onda1' } })
    await db.workspace.update({ where: { id: workspaceId }, data: { organizationId: org.id } })
    try {
      assert.equal((await postEvo(evoConnection(instance, 'close', 401))).status, 200)
      assert.deepEqual(await automations(workspaceId), { ia: false, followUp: false, disparos: false, status: 'DESCONECTADO' })
      const audit = await db.auditLog.findFirst({ where: { organizationId: org.id, acao: 'wa.disconnected' } })
      assert.ok(audit, 'auditoria registrada')
      assert.match(audit.alvo ?? '', /401/)
      assert.ok(events.some((e) => e.event === 'space.attention'), 'aviso à equipe')
      assert.ok(events.some((e) => e.event === 'connection.update'), 'tela atualizada')
    } finally {
      await db.workspace.update({ where: { id: workspaceId }, data: { organizationId: null } })
      await db.auditLog.deleteMany({ where: { organizationId: org.id } })
      await db.organization.delete({ where: { id: org.id } })
    }
  })

  it('"close" velho reprocessado da caixa de entrada depois do "open" não desfaz a conexão', async () => {
    const { workspaceId, instance } = await createBiz({ followUp: true })
    const stored = await storeInbox('evolution', JSON.stringify(evoConnection(instance, 'close', 428)))
    await db.webhookInbox.update({ where: { id: stored.id }, data: { receivedAt: new Date(Date.now() - 60_000) } })
    await postEvo(evoConnection(instance, 'open')) // estado mais novo já aplicado
    await drainInbox()
    assert.ok((await db.webhookInbox.findUnique({ where: { id: stored.id } }))?.processedAt)
    assert.equal((await automations(workspaceId)).status, 'CONECTADO')
  })

  it('close enquanto espera a leitura do QR não derruba a tela do QR', async () => {
    const { workspaceId, instance } = await createBiz()
    await db.whatsAppSession.update({ where: { workspaceId }, data: { status: 'AGUARDANDO_QR' } })
    await postEvo(evoConnection(instance, 'close', 428))
    assert.equal((await automations(workspaceId)).status, 'AGUARDANDO_QR')
  })
})
