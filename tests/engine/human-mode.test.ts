// Invariante do modo HUMANO (A1 da onda 1): conversa assumida por uma pessoa só volta para a IA por ação explícita;
// nenhum caminho automático (job antigo, varredura, envio em andamento) responde ou devolve a conversa para a IA.
// Rodar: WA_MOCK=false node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/engine/human-mode.test.ts
// (IA falsa em 127.0.0.1:3022, Evolution falsa em 127.0.0.1:3023). Telefones e textos inventados.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { enqueuePendingForWorkspace, runDueAiJobs } from '../../src/server/engine/ai-reply'
import { ingestInboundMessage } from '../../src/server/messages/ingest'
import { startFakeEvolution } from '../_fakes/fake-evolution'
import type { FakeEvolution } from '../_fakes/fake-evolution'
import { startFakeLlm } from '../_fakes/fake-llm'
import type { FakeLlm } from '../_fakes/fake-llm'
import { cleanupBiz, convOf, createBiz, db, digits, isolateSchema, jobsOf, makeDue, newPhone, sleep, uid, waitFor } from '../_fakes/test-db'

const KEY = 'chave-de-teste-evolution'
let evo: FakeEvolution
let llm: FakeLlm

const inbound = (workspaceId: string, phone: string, body: string) =>
  ingestInboundMessage({ workspaceId, from: { telefone: phone }, nome: 'Cliente Teste', body, providerMessageId: `in-${uid()}`, timestamp: new Date() })

async function scenario() {
  const { workspaceId } = await createBiz()
  const phone = newPhone()
  await inbound(workspaceId, phone, 'Quero remarcar')
  const conv = (await convOf(workspaceId, phone))!
  return { workspaceId, phone, conv }
}
const setHuman = (conversationId: string) => db.conversation.update({ where: { id: conversationId }, data: { mode: 'HUMANO' } })

before(async () => {
  await isolateSchema()
  evo = await startFakeEvolution(Number(process.env.FAKE_EVO_PORT ?? 3023))
  llm = await startFakeLlm(Number(process.env.FAKE_LLM_PORT ?? 3022), () => ({ text: 'Claro, vamos remarcar.' }))
  Object.assign(process.env, { EVOLUTION_API_URL: evo.url, EVOLUTION_API_KEY: KEY, EVOLUTION_TIMEOUT_MS: '5000', OPENAI_BASE_URL: llm.url, OPENAI_API_KEY: 'chave-falsa-de-teste', LLM_TIMEOUT_MS: '8000' })
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
  llm.set(() => ({ text: 'Claro, vamos remarcar.' }))
})

describe('conversa em HUMANO', () => {
  it('job antigo na fila não envia (nem chama o modelo)', async () => {
    const { workspaceId, conv, phone } = await scenario()
    await setHuman(conv.id)
    await makeDue(workspaceId)
    await runDueAiJobs()
    assert.equal(llm.calls, 0)
    assert.equal(evo.deliveredTo(digits(phone)).length, 0)
    const [job] = await jobsOf(conv.id)
    assert.equal(job!.status, 'feito')
    assert.match(job!.error ?? '', /modo humano/)
  })

  it('pessoa assume DURANTE a geração: a resposta é descartada', async () => {
    const { workspaceId, conv, phone } = await scenario()
    llm.set(() => ({ text: 'Claro, vamos remarcar.', delayMs: 2500 }))
    await makeDue(workspaceId)
    const run = runDueAiJobs()
    await waitFor(async () => llm.calls >= 1, { what: 'chamada ao modelo' })
    await setHuman(conv.id)
    await run
    assert.equal(evo.deliveredTo(digits(phone)).length, 0)
    assert.equal((await convOf(workspaceId, phone))!.mode, 'HUMANO')
    assert.match((await jobsOf(conv.id))[0]!.error ?? '', /modo humano/)
  })

  it('pessoa assume DURANTE o envio ao provedor: a conversa continua em HUMANO (não volta para IA)', async () => {
    const { workspaceId, conv, phone } = await scenario()
    evo.queue({ kind: 'delay', ms: 1500 })
    await makeDue(workspaceId)
    const run = runDueAiJobs()
    await waitFor(async () => evo.attempts.length >= 1, { what: 'envio em andamento' })
    await setHuman(conv.id)
    await run
    assert.equal(evo.deliveredTo(digits(phone)).length, 1, 'a mensagem já tinha saído')
    assert.equal((await convOf(workspaceId, phone))!.mode, 'HUMANO')
  })

  it('a varredura de pendentes não cria job para conversa em HUMANO', async () => {
    const { workspaceId, conv } = await scenario()
    await db.aiJob.updateMany({ where: { conversationId: conv.id }, data: { status: 'feito', error: 'limpo pelo teste', createdAt: new Date(Date.now() - 60_000) } })
    await setHuman(conv.id)
    await sleep(6_500) // a varredura só considera mensagens com mais de 6 s
    assert.equal(await enqueuePendingForWorkspace(workspaceId), 0)
    // Controle: a mesma conversa em IA seria retomada.
    await db.conversation.update({ where: { id: conv.id }, data: { mode: 'IA' } })
    assert.equal(await enqueuePendingForWorkspace(workspaceId), 1)
  })

  it('mensagem nova do cliente em HUMANO não agenda a IA', async () => {
    const { workspaceId, conv, phone } = await scenario()
    await db.aiJob.updateMany({ where: { conversationId: conv.id }, data: { status: 'feito', error: 'limpo pelo teste' } })
    await setHuman(conv.id)
    await inbound(workspaceId, phone, 'Alguém aí?')
    assert.equal((await jobsOf(conv.id)).filter((j) => j.status === 'pendente').length, 0)
  })
})
