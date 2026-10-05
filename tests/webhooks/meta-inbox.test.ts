// Webhook da API oficial (Meta): o evento é gravado na caixa de entrada ANTES do 200 (C2 da onda 1) e processado a
// partir dela; falha no processamento é repetida; reentrega não duplica; lote com item falho não perde os demais.
// Rodar: node .claude/tmp/onda1b/test-env.mjs npx tsx --test --test-concurrency=1 tests/webhooks/meta-inbox.test.ts
// Números e ids inventados; segredo do app é de TESTE.
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { POST } from '../../src/app/api/wa/meta/route'
import { drainInbox, inboxQueueIdle, overrideInboxHandler, storeInbox } from '../../src/server/whatsapp/inbox'
import { handleMetaPayload } from '../../src/server/whatsapp/meta-webhook'
import { cleanupBiz, convOf, createBiz, db, digits, isolateSchema, msgsOf, newPhone } from '../_fakes/test-db'

const SECRET = 'segredo-de-teste-meta-onda1'

function sign(raw: string) {
  return `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`
}
function post(raw: string, signature = sign(raw)) {
  return POST(new Request('http://127.0.0.1/api/wa/meta', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: raw }))
}

const wamid = () => `wamid.TESTE${randomBytes(8).toString('hex').toUpperCase()}`

function payload(phoneNumberId: string, messages: { from: string; body: string; id?: string }[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-TESTE',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511900000000', phone_number_id: phoneNumberId },
              contacts: messages.map((m) => ({ profile: { name: 'Cliente Teste' }, wa_id: digits(m.from) })),
              messages: messages.map((m) => ({ from: digits(m.from), id: m.id ?? wamid(), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: m.body } })),
            },
          },
        ],
      },
    ],
  }
}

async function metaBiz() {
  const biz = await createBiz({ provider: 'OFICIAL' })
  const phoneNumberId = `PNID${randomBytes(6).toString('hex')}`
  await db.whatsAppSession.update({ where: { workspaceId: biz.workspaceId }, data: { metaPhoneNumberId: phoneNumberId, evolutionInstance: null } })
  return { ...biz, phoneNumberId }
}

const lastMetaRow = async () => (await db.webhookInbox.findMany({ where: { provider: 'meta' }, orderBy: { receivedAt: 'desc' }, take: 1 }))[0]!

before(async () => {
  await isolateSchema()
  process.env.META_APP_SECRET = SECRET
})
after(async () => {
  overrideInboxHandler('meta', null)
  await cleanupBiz()
  await db.$disconnect()
})

describe('caixa de entrada da Meta', () => {
  it('assinatura inválida: 401 e nada gravado', async () => {
    const before = await db.webhookInbox.count({ where: { provider: 'meta' } })
    const raw = JSON.stringify(payload('PNID-x', [{ from: newPhone(), body: 'oi' }]))
    assert.equal((await post(raw, `sha256=${'0'.repeat(64)}`)).status, 401)
    assert.equal(await db.webhookInbox.count({ where: { provider: 'meta' } }), before)
  })

  it('grava antes do 200 e processa em segundo plano a partir da caixa', async () => {
    const { workspaceId, phoneNumberId } = await metaBiz()
    const phone = newPhone()
    const raw = JSON.stringify(payload(phoneNumberId, [{ from: phone, body: 'Bom dia, oficial' }]))
    // Prova de que gravou ANTES do processamento: com o tratador travado, o 200 já sai com a linha gravada.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    overrideInboxHandler('meta', async (json, ctx) => {
      await gate
      await handleMetaPayload(json, ctx)
    })
    try {
      const res = await post(raw)
      assert.equal(res.status, 200)
      const row = await lastMetaRow()
      assert.equal(row.processedAt, null, 'gravado, ainda não processado')
      assert.ok(!row.payload.includes('Bom dia'), 'corpo cifrado')
      release()
      await inboxQueueIdle()
    } finally {
      overrideInboxHandler('meta', null)
    }
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body), ['Bom dia, oficial'])
    assert.ok((await lastMetaRow()).processedAt)
  })

  it('falha no processamento: fica pendente com espera e o agendador reprocessa UMA vez; reentrega não duplica', async () => {
    const { workspaceId, phoneNumberId } = await metaBiz()
    const phone = newPhone()
    const raw = JSON.stringify(payload(phoneNumberId, [{ from: phone, body: 'Vai falhar uma vez' }]))
    overrideInboxHandler('meta', async () => {
      throw new Error('banco fora (simulado)')
    })
    try {
      assert.equal((await post(raw)).status, 200)
      await inboxQueueIdle()
    } finally {
      overrideInboxHandler('meta', null)
    }
    const row = await lastMetaRow()
    assert.equal(row.processedAt, null)
    assert.equal(row.attempts, 1)
    assert.match(row.lastError ?? '', /banco fora/)
    assert.equal(await convOf(workspaceId, phone), null)
    // A Meta reentrega o mesmo corpo: mesma linha (não duplica); a reentrega é uma nova chance de processar.
    assert.equal((await post(raw)).status, 200)
    await inboxQueueIdle()
    assert.equal(await db.webhookInbox.count({ where: { provider: 'meta', dedupeKey: row.dedupeKey } }), 1)
    await db.webhookInbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } })
    await drainInbox()
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.equal((await msgsOf(conv.id)).length, 1)
    assert.ok((await db.webhookInbox.findUnique({ where: { id: row.id } }))?.processedAt)
  })

  it('gravação falha: 503 (a Meta reentrega por até 7 dias)', async () => {
    const { phoneNumberId } = await metaBiz()
    const raw = JSON.stringify(payload(phoneNumberId, [{ from: newPhone(), body: 'x' }]))
    const delegate = db.webhookInbox as unknown as { create: (...a: unknown[]) => unknown }
    const original = delegate.create
    delegate.create = () => {
      throw new Error("Can't reach database server (simulado)")
    }
    try {
      assert.equal((await post(raw)).status, 503)
    } finally {
      delegate.create = original
    }
  })

  it('queda entre o 200 e o processamento: drenado depois; o mesmo id em outro lote não duplica', async () => {
    const { workspaceId, phoneNumberId } = await metaBiz()
    const phone = newPhone()
    const id = wamid()
    await storeInbox('meta', JSON.stringify(payload(phoneNumberId, [{ from: phone, body: 'Durante o deploy', id }])))
    assert.ok((await drainInbox()) >= 1)
    const again = JSON.stringify({ ...payload(phoneNumberId, [{ from: phone, body: 'Durante o deploy', id }]), extra: 1 })
    assert.equal((await post(again)).status, 200)
    await inboxQueueIdle()
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.equal((await msgsOf(conv.id)).length, 1)
  })

  it('lote com uma mensagem que falha: as demais entram (erro por mensagem, não por lote)', async () => {
    const { workspaceId, phoneNumberId } = await metaBiz()
    const phone = newPhone()
    const raw = JSON.stringify(payload(phoneNumberId, [{ from: phone, body: 'um' }, { from: phone, body: 'falha' }, { from: phone, body: 'três' }]))
    const delegate = db.message as unknown as { create: (args: { data: { body?: string } }) => unknown }
    const original = delegate.create
    delegate.create = (args) => {
      if (args.data.body === 'falha') throw new Error('simulado')
      return original.call(db.message, args)
    }
    try {
      assert.equal((await post(raw)).status, 200)
      await inboxQueueIdle()
    } finally {
      delegate.create = original
    }
    const conv = await convOf(workspaceId, phone)
    assert.ok(conv)
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body).sort(), ['três', 'um'])
    const row = await lastMetaRow()
    await db.webhookInbox.update({ where: { id: row.id }, data: { nextAttemptAt: new Date() } })
    await drainInbox()
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body).sort(), ['falha', 'três', 'um'])
  })
})
