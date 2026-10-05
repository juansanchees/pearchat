// Webhook da Evolution: caixa de entrada durável (C1 da onda 1), idempotência e tipos ao vivo (C3).
// Rodar (schema de teste, Evolution falsa em 127.0.0.1:3023):
//   node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/webhooks/evolution-inbox.test.ts   (com WA_MOCK=false)
// Telefones e textos inventados.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { POST } from '../../src/app/api/wa/evolution/route'
import { drainInbox, storeInbox } from '../../src/server/whatsapp/inbox'
import { evoConnection, evoId, evoStatus, evoUpsert, startFakeEvolution } from '../_fakes/fake-evolution'
import type { FakeEvolution } from '../_fakes/fake-evolution'
import { cleanupBiz, convOf, createBiz, db, isolateSchema, jidOf, jobsOf, msgsOf, newPhone } from '../_fakes/test-db'

const KEY = 'chave-de-teste-evolution'
let evo: FakeEvolution

function post(body: unknown, opts: { raw?: string; apikey?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body)
  return POST(new Request('http://127.0.0.1/api/wa/evolution', { method: 'POST', headers: { 'content-type': 'application/json', apikey: opts.apikey ?? KEY }, body: raw }))
}

const inboxRows = () => db.webhookInbox.findMany({ where: { provider: 'evolution' }, orderBy: { receivedAt: 'asc' } })

/** Troca db.message.create por uma versão que falha quando `when` é verdadeiro (simula pool esgotado/queda do banco). */
function failMessageCreate(when: (data: { body?: string }) => boolean) {
  const delegate = db.message as unknown as { create: (args: { data: { body?: string } }) => unknown }
  const original = delegate.create
  delegate.create = (args) => {
    if (when(args.data)) throw new Error('Timed out fetching a new connection from the connection pool (simulado)')
    return original.call(db.message, args)
  }
  return () => {
    delegate.create = original
  }
}

before(async () => {
  await isolateSchema()
  evo = await startFakeEvolution(3023)
  process.env.EVOLUTION_API_URL = evo.url
  process.env.EVOLUTION_API_KEY = KEY
})
after(async () => {
  await cleanupBiz()
  await evo.close()
  await db.$disconnect()
})
beforeEach(async () => {
  await db.webhookInbox.updateMany({ where: { processedAt: null, deadAt: null }, data: { deadAt: new Date() } })
})

describe('caixa de entrada da Evolution', () => {
  it('recusa apikey errada (401) e ignora instância desconhecida (200, sem efeito)', async () => {
    const r1 = await post(evoUpsert('pc_x', { remoteJid: jidOf(newPhone()), message: { conversation: 'oi' } }), { apikey: 'errada' })
    assert.equal(r1.status, 401)
    const r2 = await post(evoUpsert('pc_inexistente', { remoteJid: jidOf(newPhone()), message: { conversation: 'oi' } }))
    assert.equal(r2.status, 200)
  })

  it('grava o evento antes do 200, processa e marca como processado', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    const res = await post(evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'Olá, tudo bem?' } }))
    assert.equal(res.status, 200)
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    const msgs = await msgsOf(conv.id)
    assert.deepEqual(
      msgs.map((m) => [m.direction, m.body]),
      [['IN', 'Olá, tudo bem?']],
    )
    const rows = await inboxRows()
    const last = rows[rows.length - 1]!
    assert.ok(last.processedAt, 'linha processada')
    assert.equal(last.attempts, 1)
    assert.ok(!last.payload.includes('Olá'), 'corpo guardado cifrado')
  })

  it('falha de banco no meio: responde 200 (já gravado), fica pendente e o reprocessamento grava UMA vez', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    const restore = failMessageCreate(() => true)
    let res: Response
    try {
      res = await post(evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'Quero agendar' } }))
    } finally {
      restore()
    }
    assert.equal(res.status, 200)
    const conv = await convOf(workspaceId, phone)
    assert.equal(conv ? (await msgsOf(conv.id)).length : 0, 0, 'nada gravado ainda')
    let rows = await inboxRows()
    let row = rows[rows.length - 1]!
    assert.equal(row.processedAt, null)
    assert.equal(row.attempts, 1)
    assert.match(row.lastError ?? '', /Timed out|falharam/)
    assert.ok(row.nextAttemptAt > new Date(), 'próxima tentativa com espera')

    // O agendador drena quando a espera vence.
    await db.webhookInbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } })
    assert.equal(await drainInbox(), 1)
    const conv2 = await convOf(workspaceId, phone)
    assert.ok(conv2)
    assert.equal((await msgsOf(conv2.id)).filter((m) => m.body === 'Quero agendar').length, 1)
    rows = await inboxRows()
    row = rows.find((r) => r.id === row.id)!
    assert.ok(row.processedAt)
    assert.equal(row.attempts, 2)
  })

  it('reentrega idêntica e reentrega com outro envelope do MESMO id não duplicam', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    const id = evoId()
    const payload = evoUpsert(instance, { id, remoteJid: jidOf(phone), message: { conversation: 'Mensagem única' } })
    const raw = JSON.stringify(payload)
    assert.equal((await post(null, { raw })).status, 200)
    const before = (await inboxRows()).length
    assert.equal((await post(null, { raw })).status, 200)
    assert.equal((await inboxRows()).length, before, 'mesmo corpo = mesma linha')
    const other = { ...payload, date_time: new Date(Date.now() + 5000).toISOString() }
    assert.equal((await post(other)).status, 200)
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.equal((await msgsOf(conv.id)).length, 1)
  })

  it('gravação na caixa falha: 503 (a Evolution reentrega) e a reentrega grava', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    const payload = evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'Chegou?' } })
    const delegate = db.webhookInbox as unknown as { create: (...a: unknown[]) => unknown }
    const original = delegate.create
    delegate.create = () => {
      throw new Error("Can't reach database server (simulado)")
    }
    let res: Response
    try {
      res = await post(payload)
    } finally {
      delegate.create = original
    }
    assert.equal(res.status, 503)
    assert.equal(await convOf(workspaceId, phone), null)
    assert.equal((await post(payload)).status, 200)
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.equal((await msgsOf(conv.id)).length, 1)
  })

  it('lote com uma mensagem que falha: as outras entram; a que falhou entra no reprocessamento, sem duplicar', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    const a = evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'primeira' } })
    const b = evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'falha' } })
    const c = evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'terceira' } })
    const batch = { ...a, data: [a.data, b.data, c.data] }
    const restore = failMessageCreate((d) => d.body === 'falha')
    try {
      assert.equal((await post(batch)).status, 200)
    } finally {
      restore()
    }
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body).sort(), ['primeira', 'terceira'])
    const rows = await inboxRows()
    const row = rows[rows.length - 1]!
    assert.equal(row.processedAt, null)
    await db.webhookInbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } })
    await drainInbox()
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body).sort(), ['falha', 'primeira', 'terceira'])
  })

  it('queda do processo entre o 200 e o processamento: o evento gravado é drenado depois (subida/agendador)', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    // Só a gravação (o que acontece antes do 200); o processamento "não aconteceu".
    const stored = await storeInbox('evolution', JSON.stringify(evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'Durante o deploy' } })))
    assert.equal(stored.duplicate, false)
    assert.equal(await convOf(workspaceId, phone), null)
    assert.ok((await drainInbox()) >= 1)
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body), ['Durante o deploy'])
  })

  it('status por id do provedor atualiza a mensagem enviada', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    await post(evoUpsert(instance, { remoteJid: jidOf(phone), message: { conversation: 'oi' } }))
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    const id = evoId()
    await db.message.create({ data: { conversationId: conv.id, direction: 'OUT', author: 'IA', body: 'Olá!', status: 'ENVIADA', providerMessageId: id } })
    assert.equal((await post(evoStatus(instance, { keyId: id, status: 'DELIVERY_ACK', remoteJid: jidOf(phone) }))).status, 200)
    assert.equal((await db.message.findFirst({ where: { providerMessageId: id } }))?.status, 'ENTREGUE')
  })

  it('evento de conexão também passa pela caixa (e é processado)', async () => {
    const { workspaceId, instance } = await createBiz()
    const before = (await inboxRows()).length
    assert.equal((await post(evoConnection(instance, 'open'))).status, 200)
    assert.equal((await inboxRows()).length, before + 1)
    assert.equal((await db.whatsAppSession.findUnique({ where: { workspaceId } }))?.status, 'CONECTADO')
  })
})

describe('tipos ao vivo (C3): nada é descartado em silêncio', () => {
  // [mensagem do protocolo, corpo esperado, aciona a IA?]
  const CASES: [string, Record<string, unknown>, string | RegExp, boolean][] = [
    ['localização', { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: 'Padaria Teste', address: 'Rua Inventada, 100' } }, '[Localização] Padaria Teste, Rua Inventada, 100 https://maps.google.com/?q=-23.5,-46.6', true],
    ['localização ao vivo', { liveLocationMessage: { degreesLatitude: -22.9, degreesLongitude: -43.2 } }, '[Localização] https://maps.google.com/?q=-22.9,-43.2', true],
    ['cartão de contato', { contactMessage: { displayName: 'Ana Teste', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Teste\nTEL;type=CELL;waid=5511988887777:+55 11 98888-7777\nEND:VCARD' } }, '[Contato] Ana Teste (+5511988887777)', true],
    ['vários contatos', { contactsArrayMessage: { contacts: [{ displayName: 'Beto', vcard: 'BEGIN:VCARD\nFN:Beto\nTEL:+55 21 3333-4444\nEND:VCARD' }, { displayName: 'Carla' }] } }, '[Contato] Beto (+55 21 3333-4444); Carla', true],
    ['resposta de botão', { buttonsResponseMessage: { selectedButtonId: 'b1', selectedDisplayText: 'Quero confirmar' } }, 'Quero confirmar', true],
    ['resposta de lista', { listResponseMessage: { title: 'Corte de cabelo', singleSelectReply: { selectedRowId: 'r1' } } }, 'Corte de cabelo', true],
    ['resposta de botão de modelo', { templateButtonReplyMessage: { selectedId: 't1', selectedDisplayText: 'Sim' } }, 'Sim', true],
    ['enquete', { pollCreationMessageV3: { name: 'Qual horário?', options: [{ optionName: '10h' }] } }, '[Enquete] Qual horário?', false],
    ['tipo desconhecido', { algumTipoNovoMessage: { foo: 1 } }, '[Mensagem não suportada]', false],
  ]

  for (const [nome, message, expected, ai] of CASES) {
    it(`${nome}: gravado como "${String(expected).slice(0, 40)}" e ${ai ? 'aciona' : 'NÃO aciona'} a IA`, async () => {
      const { workspaceId, instance } = await createBiz()
      const phone = newPhone()
      assert.equal((await post(evoUpsert(instance, { remoteJid: jidOf(phone), message }))).status, 200)
      const conv = await convOf(workspaceId, phone)
      assert.ok(conv, 'conversa criada')
      const msgs = await msgsOf(conv.id)
      assert.equal(msgs.length, 1)
      if (expected instanceof RegExp) assert.match(msgs[0]!.body, expected)
      else assert.equal(msgs[0]!.body, expected)
      assert.equal((await jobsOf(conv.id)).length, ai ? 1 : 0)
    })
  }

  it('reação e mensagem de protocolo não viram conversa', async () => {
    const { workspaceId, instance } = await createBiz()
    const phone = newPhone()
    await post(evoUpsert(instance, { remoteJid: jidOf(phone), message: { reactionMessage: { text: '👍', key: { id: 'X' } } } }))
    await post(evoUpsert(instance, { remoteJid: jidOf(phone), message: { protocolMessage: { type: 0 } } }))
    assert.equal(await convOf(workspaceId, phone), null)
  })
})
