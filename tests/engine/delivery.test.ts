// Envio sem confirmação (C4 da onda 1): timeout/queda depois de o provedor aceitar NÃO reenvia às cegas; o eco/consulta
// à Evolution reconcilia; o eco do próprio envio não joga a conversa para HUMANO; recusa real reenvia (uma vez) e marca o
// motivo. Também: ordem de chegada (A2) e chave de idempotência por job.
// Rodar: WA_MOCK=false node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/engine/delivery.test.ts
// (IA falsa em 127.0.0.1:3022, Evolution falsa em 127.0.0.1:3023). Telefones e textos inventados.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Message } from '@prisma/client'
import { POST } from '../../src/app/api/wa/evolution/route'
import { runDueAiJobs } from '../../src/server/engine/ai-reply'
import { NOT_CONFIRMED_REASON, reconcileUncertainSends } from '../../src/server/engine/delivery'
import { OutboundAlreadySentError, sendAndRecord } from '../../src/server/engine/outbound'
import { getConnected } from '../../src/server/engine/util'
import { ingestInboundMessage } from '../../src/server/messages/ingest'
import { drainInbox, storeInbox } from '../../src/server/whatsapp/inbox'
import { evoId, evoSendMessage, evoUpsert, startFakeEvolution } from '../_fakes/fake-evolution'
import type { FakeEvolution } from '../_fakes/fake-evolution'
import { startFakeLlm } from '../_fakes/fake-llm'
import type { FakeLlm } from '../_fakes/fake-llm'
import { captureEvents, cleanupBiz, convOf, createBiz, db, digits, isolateSchema, jidOf, jobsOf, makeDue, msgsOf, newPhone, uid } from '../_fakes/test-db'

const KEY = 'chave-de-teste-evolution'
const REPLY = 'Olá! Temos horário amanhã às 10h.'
let evo: FakeEvolution
let llm: FakeLlm
const events = captureEvents()

const postEvo = (body: unknown) =>
  POST(new Request('http://127.0.0.1/api/wa/evolution', { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify(body) }))

async function inbound(workspaceId: string, phone: string, body: string, at = new Date()) {
  await ingestInboundMessage({ workspaceId, from: { telefone: phone }, nome: 'Cliente Teste', body, providerMessageId: `in-${uid()}`, timestamp: at })
}

/** Uma passada do motor de IA com os jobs do workspace vencidos. */
async function runAi(workspaceId: string) {
  await makeDue(workspaceId)
  return runDueAiJobs()
}

const outs = async (conversationId: string) => (await msgsOf(conversationId)).filter((m) => m.direction === 'OUT')

/** Cenário base: cliente escreve; a IA gera e o envio fica sem confirmação. */
async function uncertainScenario(mode: Parameters<FakeEvolution['queue']>[0]) {
  const { workspaceId, instance } = await createBiz()
  const phone = newPhone()
  await inbound(workspaceId, phone, 'Tem horário amanhã?')
  const conv = (await convOf(workspaceId, phone))!
  evo.queue(mode)
  await runAi(workspaceId)
  const [out] = await outs(conv.id)
  return { workspaceId, instance, phone, conv, out: out! }
}

before(async () => {
  await isolateSchema()
  evo = await startFakeEvolution(3023)
  llm = await startFakeLlm(3022, () => ({ text: REPLY }))
  Object.assign(process.env, {
    EVOLUTION_API_URL: evo.url,
    EVOLUTION_API_KEY: KEY,
    EVOLUTION_TIMEOUT_MS: '600',
    OPENAI_BASE_URL: llm.url,
    OPENAI_API_KEY: 'chave-falsa-de-teste',
    LLM_TIMEOUT_MS: '5000',
    DELIVERY_UNCERTAIN_MS: '1000',
  })
  delete process.env.ANTHROPIC_API_KEY
})
after(async () => {
  await cleanupBiz()
  await evo.close()
  await llm.close()
  await db.$disconnect()
})
beforeEach(async () => {
  // Cada teste só vê os próprios jobs (o motor processa o schema inteiro).
  await db.aiJob.updateMany({ where: { status: { in: ['pendente', 'executando'] } }, data: { status: 'feito', error: 'limpo pelo teste' } })
  evo.reset()
  llm.reset()
  llm.set(() => ({ text: REPLY }))
  events.length = 0
})

describe('envio sem confirmação (timeout depois de o provedor aceitar)', () => {
  it('fica PENDENTE "incerto" (nunca FALHOU) e o job espera em vez de reenviar', async () => {
    const { conv, phone, out } = await uncertainScenario({ kind: 'delay', ms: 1500 })
    assert.equal(evo.deliveredTo(digits(phone)).length, 1, 'o provedor entregou')
    assert.equal(out.status, 'PENDENTE')
    assert.ok(out.uncertainSince, 'marcado como incerto')
    assert.equal(out.sendKey?.startsWith('ai:'), true)
    const [job] = await jobsOf(conv.id)
    assert.equal(job!.status, 'pendente')
    assert.match(job!.error ?? '', /aguardando-confirmacao/)
    // Nova passada antes da confirmação: continua esperando, sem gerar nem enviar de novo.
    await runAi(conv.workspaceId)
    assert.equal(llm.calls, 1)
    assert.equal(evo.attempts.length, 1)
  })

  it('eco SEND_MESSAGE confirma: vincula o id, NÃO reenvia e a conversa NÃO vai para HUMANO', async () => {
    const { workspaceId, instance, conv, phone } = await uncertainScenario({ kind: 'delay', ms: 1500 })
    const d = evo.deliveredTo(digits(phone))[0]!
    assert.equal((await postEvo(evoSendMessage(instance, { id: d.id, remoteJid: d.remoteJid, text: d.text }))).status, 200)
    const [out] = await outs(conv.id)
    assert.equal(out!.status, 'ENVIADA')
    assert.equal(out!.providerMessageId, d.id)
    assert.equal(out!.uncertainSince, null)
    await runAi(workspaceId)
    const [job] = await jobsOf(conv.id)
    assert.equal(job!.status, 'feito')
    assert.match(job!.error ?? '', /já enviada/)
    assert.equal(evo.attempts.length, 1, 'não reenviou')
    assert.equal(llm.calls, 1)
    assert.notEqual((await convOf(workspaceId, phone))!.mode, 'HUMANO')
    // Eco tardio do mesmo envio como messages.upsert fromMe: reconhecido pelo id, não vira "resposta pelo celular".
    await postEvo(evoUpsert(instance, { id: d.id, remoteJid: d.remoteJid, fromMe: true, message: { conversation: d.text } }))
    assert.equal((await outs(conv.id)).length, 1)
    assert.notEqual((await convOf(workspaceId, phone))!.mode, 'HUMANO')
  })

  it('eco messages.upsert fromMe (sem SEND_MESSAGE) também confirma e não assume a conversa', async () => {
    const { workspaceId, instance, conv, phone } = await uncertainScenario({ kind: 'delay', ms: 1500 })
    const d = evo.deliveredTo(digits(phone))[0]!
    await postEvo(evoUpsert(instance, { id: d.id, remoteJid: d.remoteJid, fromMe: true, message: { conversation: d.text } }))
    const list = await outs(conv.id)
    assert.equal(list.length, 1, 'não gravou uma segunda mensagem')
    assert.equal(list[0]!.status, 'ENVIADA')
    assert.equal(list[0]!.author, 'IA')
    assert.notEqual((await convOf(workspaceId, phone))!.mode, 'HUMANO')
  })

  it('sem eco: a consulta ativa à Evolution (findMessages) acha o envio e confirma', async () => {
    const { workspaceId, conv, phone } = await uncertainScenario({ kind: 'delay', ms: 1500 })
    await new Promise((r) => setTimeout(r, 1000)) // a Evolution falsa termina de "responder"
    const n = await reconcileUncertainSends(new Date(Date.now() + 25_000))
    assert.ok(n >= 1)
    assert.ok(evo.findCalls.includes(jidOf(phone)))
    const [out] = await outs(conv.id)
    assert.equal(out!.status, 'ENVIADA')
    assert.equal(out!.providerMessageId, evo.deliveredTo(digits(phone))[0]!.id)
    await runAi(workspaceId)
    assert.equal(evo.attempts.length, 1, 'não reenviou')
  })

  it('conexão caída no meio do envio (entregue) e resposta 2xx ilegível: incertos, confirmados pela consulta', async () => {
    for (const mode of [{ kind: 'drop' as const }, { kind: 'garbage' as const }]) {
      evo.reset()
      const { conv, phone } = await uncertainScenario(mode)
      const [out] = await outs(conv.id)
      assert.equal(out!.status, 'PENDENTE', mode.kind)
      assert.ok(out!.uncertainSince, mode.kind)
      await reconcileUncertainSends(new Date(Date.now() + 25_000))
      assert.equal((await outs(conv.id))[0]!.status, 'ENVIADA', mode.kind)
      assert.equal(evo.deliveredTo(digits(phone)).length, 1)
    }
  })

  it('NÃO entregue e sem evidência: depois do prazo vira FALHOU com motivo e a IA reenvia UMA vez', async () => {
    const { workspaceId, conv, phone } = await uncertainScenario({ kind: 'delay', ms: 1500, deliver: false })
    assert.equal(evo.deliveredTo(digits(phone)).length, 0)
    // Antes do prazo: continua incerta.
    await reconcileUncertainSends(new Date(Date.now() + 500))
    assert.equal((await outs(conv.id))[0]!.status, 'PENDENTE')
    await reconcileUncertainSends(new Date(Date.now() + 25_000))
    const [failed] = await outs(conv.id)
    assert.equal(failed!.status, 'FALHOU')
    assert.equal(failed!.failReason, NOT_CONFIRMED_REASON)
    await runAi(workspaceId)
    const list = await outs(conv.id)
    assert.deepEqual(
      list.map((m) => m.status),
      ['FALHOU', 'ENVIADA'],
    )
    assert.equal(evo.deliveredTo(digits(phone)).length, 1, 'cliente recebeu uma resposta só')
    assert.equal(llm.calls, 2)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'feito')
    assert.notEqual((await convOf(workspaceId, phone))!.mode, 'HUMANO')
  })
})

describe('recusa real e eco do celular', () => {
  it('recusa do provedor (500): FALHOU com motivo e UMA nova tentativa entrega', async () => {
    const { workspaceId, conv, phone } = await uncertainScenario({ kind: 'status', status: 500 })
    const [failed] = await outs(conv.id)
    assert.equal(failed!.status, 'FALHOU')
    assert.match(failed!.failReason ?? '', /respondeu 500/)
    assert.equal(failed!.uncertainSince, null)
    const [job] = await jobsOf(conv.id)
    assert.equal(job!.status, 'pendente')
    await runAi(workspaceId)
    assert.deepEqual(
      (await outs(conv.id)).map((m) => m.status),
      ['FALHOU', 'ENVIADA'],
    )
    assert.equal(evo.deliveredTo(digits(phone)).length, 1)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'feito')
  })

  it('recusas seguidas esgotam as tentativas: job "erro", conversa passa para uma pessoa e a equipe é avisada', async () => {
    const { workspaceId, conv, phone } = await uncertainScenario({ kind: 'status', status: 500 })
    evo.queue({ kind: 'status', status: 500 }, { kind: 'status', status: 500 }, { kind: 'status', status: 500 })
    await runAi(workspaceId) // 2ª
    const [waiting] = await jobsOf(conv.id)
    assert.equal(waiting!.status, 'pendente')
    await runAi(workspaceId) // 3ª: a próxima espera é longa (5 min)
    const [late] = await jobsOf(conv.id)
    assert.equal(late!.status, 'pendente')
    assert.ok(late!.runAt.getTime() - Date.now() > 4 * 60_000, 'última tentativa só depois de ~5 min')
    await runAi(workspaceId) // 4ª e última
    assert.equal(evo.deliveredTo(digits(phone)).length, 0)
    assert.equal((await jobsOf(conv.id))[0]!.status, 'erro')
    assert.equal((await convOf(workspaceId, phone))!.mode, 'HUMANO')
    assert.ok(events.some((e) => e.event === 'handoff.requested'))
  })

  it('mensagem enviada PELO CELULAR (texto novo): gravada como USER e a conversa vai para HUMANO (como antes)', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    await inbound(workspaceId, phone, 'Oi')
    await postEvo(evoUpsert(instance, { id: evoId(), remoteJid: jidOf(phone), fromMe: true, message: { conversation: 'Oi! Aqui é a Mariana, pode falar.' } }))
    const conv = (await convOf(workspaceId, phone))!
    const list = await outs(conv.id)
    assert.equal(list.length, 1)
    assert.equal(list[0]!.author, 'USER')
    assert.equal(conv.mode, 'HUMANO')
  })
})

describe('idempotência e ordem', () => {
  it('a mesma sendKey nunca envia duas vezes', async () => {
    const { workspaceId } = await createBiz()
    const phone = newPhone()
    await inbound(workspaceId, phone, 'oi')
    const conv = (await convOf(workspaceId, phone))!
    const session = (await getConnected(workspaceId))!
    const input = { session, conversationId: conv.id, to: { telefone: phone }, author: 'IA' as const, content: { kind: 'text' as const, text: 'Lembrete de teste' }, sendKey: `teste:${uid()}` }
    await sendAndRecord(input)
    await assert.rejects(sendAndRecord(input), OutboundAlreadySentError)
    assert.equal(evo.deliveredTo(digits(phone)).length, 1)
  })

  it('falha de banco ao gravar o id depois de o provedor aceitar: nunca vira FALHOU; a reconciliação aplica o id', async () => {
    const { workspaceId } = await createBiz()
    const phone = newPhone()
    await inbound(workspaceId, phone, 'oi')
    const conv = (await convOf(workspaceId, phone))!
    const session = (await getConnected(workspaceId))!
    const delegate = db.message as unknown as { update: (args: { data: { providerMessageId?: string } }) => unknown }
    const original = delegate.update
    delegate.update = (args) => {
      if (args.data.providerMessageId) throw new Error('Timed out fetching a new connection (simulado)')
      return original.call(db.message, args)
    }
    let sent: Message
    try {
      sent = await sendAndRecord({ session, conversationId: conv.id, to: { telefone: phone }, author: 'IA', content: { kind: 'text', text: 'Confirmado!' }, sendKey: `teste:${uid()}` })
    } finally {
      delegate.update = original
    }
    assert.equal(sent.status, 'ENVIADA', 'quem chama vê como enviada')
    const [row] = await outs(conv.id)
    assert.equal(row!.status, 'PENDENTE', 'no banco ainda sem id')
    await reconcileUncertainSends()
    const [fixed] = await outs(conv.id)
    assert.equal(fixed!.status, 'ENVIADA')
    assert.equal(fixed!.providerMessageId, evo.deliveredTo(digits(phone))[0]!.id)
  })

  it('mensagem que falhou e foi reprocessada DEPOIS de uma resposta nossa não é dada por respondida', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    await inbound(workspaceId, phone, 'Primeira')
    const conv = (await convOf(workspaceId, phone))!
    // A segunda chegou antes da nossa resposta, mas a gravação falhou: ficou na caixa de entrada.
    const stored = await storeInbox('evolution', JSON.stringify(evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'Segunda (atrasada)' } })))
    await db.webhookInbox.update({ where: { id: stored.id }, data: { receivedAt: new Date(Date.now() - 2_000) } })
    await runAi(workspaceId) // responde a primeira
    await drainInbox() // a segunda entra agora
    assert.deepEqual(
      (await msgsOf(conv.id)).map((m) => m.direction),
      ['IN', 'OUT', 'IN'],
    )
    await runAi(workspaceId)
    assert.deepEqual(
      (await msgsOf(conv.id)).map((m) => m.direction),
      ['IN', 'OUT', 'IN', 'OUT'],
    )
  })

  it('A2: mensagem do cliente que chega DURANTE o nosso envio fica depois dele (hora de chegada) e é respondida', async () => {
    const { workspaceId } = await createBiz()
    const phone = newPhone()
    await inbound(workspaceId, phone, 'Primeira pergunta')
    const conv = (await convOf(workspaceId, phone))!
    await runAi(workspaceId)
    const [ourReply] = await outs(conv.id)
    assert.equal(ourReply!.status, 'ENVIADA')
    // Carimbo do WhatsApp em segundos (truncado) ANTERIOR ao nosso envio, mas chegou depois dele.
    const waTs = new Date(Math.floor((ourReply!.createdAt.getTime() - 400) / 1000) * 1000)
    await inbound(workspaceId, phone, 'E no sábado?', waTs)
    const msgs = await msgsOf(conv.id)
    assert.deepEqual(
      msgs.map((m) => m.direction),
      ['IN', 'OUT', 'IN'],
    )
    await runAi(workspaceId)
    assert.deepEqual(
      (await msgsOf(conv.id)).map((m) => m.direction),
      ['IN', 'OUT', 'IN', 'OUT'],
    )
  })
})
