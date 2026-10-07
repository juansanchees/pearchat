/* eslint-disable @typescript-eslint/no-explicit-any */
// LID do WhatsApp (@lid): recebimento, envio pela Evolution (servidor falso local) e conversas pendentes.
// Precisa de um schema de TESTE do Postgres (confere abaixo) e de ENGINE_DISABLED=true. Rodar (porta do servidor falso: FAKE_EVO_PORT, padrão 3045):
//   node .claude/tmp/diag-envio/test-env.mjs npx tsx --test tests/lid-contacts.test.ts
// Os números e LIDs abaixo são inventados (nenhum dado de cliente).
import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'
import { db } from '../src/lib/db'
import { normalizePhone } from '../src/server/contacts/phone'
import { findPending } from '../src/server/engine/pending'
import { sendAndRecord } from '../src/server/engine/outbound'
import { findOrCreateContact, ingestInboundMessage } from '../src/server/messages/ingest'
import { normalizeEvolutionEvent } from '../src/server/whatsapp/normalize'
import { EvolutionProvider } from '../src/server/whatsapp/evolution'
import { evolutionRecipient, lidDigits, NO_RECIPIENT } from '../src/server/whatsapp/phone'

assert.match(new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema') ?? '', /^pearchat_test_/, 'use um schema de teste')

const LID = '264900000000001'
const LID2 = '199000000000002'
const PHONE_BR = '+5511999990001'
const PHONE_BR8 = '+551188880002' // celular antigo (8 dígitos)
const PHONE_MX = '+5215512345678' // México com o "1" de celular
const PHONE_AR = '+5491155550003'
const PHONE_US = '+14155550004'

// ---------------------------------------------------------------- Evolution falsa

type Hit = { path: string; number?: string; text?: string }
const hits: Hit[] = []
let server: http.Server
const ev = { force: 0 as number }

function startFakeEvolution(port: number): Promise<void> {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const send = (status: number, obj: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (!req.url?.startsWith('/message/send')) return send(404, { message: 'x' })
      hits.push({ path: req.url, number: body.number, text: body.text })
      if (ev.force) return send(ev.force, { message: 'fora do ar' })
      const n = String(body.number ?? '')
      // Imita a 2.3.7: telefone (dígitos de 8 a 13) ou JID "<lid>@lid" existem; LID sem sufixo (14-15 dígitos) = exists:false.
      const ok = /^\d{8,13}$/.test(n) || /^\d{5,}@lid$/.test(n) || /^\d+@s\.whatsapp\.net$/.test(n)
      if (!ok) return send(400, { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: `${n}@s.whatsapp.net`, number: n }] } })
      send(201, { key: { remoteJid: n.includes('@') ? n : `${n}@s.whatsapp.net`, fromMe: true, id: `FAKE${hits.length}` }, status: 'PENDING' })
    })
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', r))
}

// ---------------------------------------------------------------- Dados

const wsIds: string[] = []
async function newWorkspace(rapida = true) {
  const ws = await db.workspace.create({ data: { nome: 'Teste LID' } })
  wsIds.push(ws.id)
  if (rapida) await db.whatsAppSession.create({ data: { workspaceId: ws.id, provider: 'RAPIDA', status: 'CONECTADO' } })
  return ws.id
}

before(async () => {
  const port = Number(process.env.FAKE_EVO_PORT || 3045)
  await startFakeEvolution(port)
  process.env.EVOLUTION_API_URL = `http://127.0.0.1:${port}`
  process.env.EVOLUTION_API_KEY = 'chave-de-teste'
})
after(async () => {
  await new Promise((r) => server.close(r))
  await db.workspace.deleteMany({ where: { id: { in: wsIds } } })
  await db.$disconnect()
})

// ---------------------------------------------------------------- Normalização do webhook

const upsert = (key: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  normalizeEvolutionEvent({
    event: 'messages.upsert',
    instance: 'pc_x',
    data: { key: { id: `ID${Math.random()}`, fromMe: false, ...key }, pushName: 'Cliente', messageTimestamp: 1_700_000_000, message: { conversation: 'hola' }, ...extra },
  })

describe('webhook @lid', () => {
  it('@lid com remoteJidAlt: LID em waUserId e o telefone real em telefone', () => {
    const e = upsert({ remoteJid: `${LID}@lid`, remoteJidAlt: '5215512345678@s.whatsapp.net' })
    assert.equal(e.kind, 'messages')
    if (e.kind !== 'messages') return
    assert.deepEqual(e.inbound[0].from, { waUserId: LID, telefone: '+5215512345678' })
  })
  it('@lid com senderPn (Baileys 6): idem', () => {
    const e = upsert({ remoteJid: `${LID}@lid`, senderPn: '5511999990001@s.whatsapp.net' })
    if (e.kind !== 'messages') return assert.fail()
    assert.deepEqual(e.inbound[0].from, { waUserId: LID, telefone: '+5511999990001' })
  })
  it('@lid sem telefone: só waUserId, NUNCA telefone', () => {
    const e = upsert({ remoteJid: `${LID}@lid` })
    if (e.kind !== 'messages') return assert.fail()
    assert.deepEqual(e.inbound[0].from, { waUserId: LID })
  })
  it('alt com sufixo de dispositivo não vira número com dígitos a mais', () => {
    const e = upsert({ remoteJid: `${LID}@lid`, remoteJidAlt: '5511999990001:12@s.whatsapp.net' })
    if (e.kind !== 'messages') return assert.fail()
    assert.equal(e.inbound[0].from.telefone, '+5511999990001')
  })
  it('@s.whatsapp.net normal (BR, MX, US): telefone, sem waUserId', () => {
    for (const [jid, tel] of [['5511999990001', '+5511999990001'], ['5215512345678', '+5215512345678'], ['14155550004', '+14155550004']]) {
      const e = upsert({ remoteJid: `${jid}@s.whatsapp.net` })
      if (e.kind !== 'messages') return assert.fail()
      assert.deepEqual(e.inbound[0].from, { telefone: tel })
    }
  })
  it('fromMe com @lid: o chat é o LID', () => {
    const e = upsert({ remoteJid: `${LID}@lid`, fromMe: true })
    if (e.kind !== 'messages') return assert.fail()
    assert.deepEqual(e.outbound[0].to, { waUserId: LID })
  })
})

// ---------------------------------------------------------------- Destinatário

describe('evolutionRecipient', () => {
  it('telefone vale; sem telefone usa <lid>@lid', () => {
    assert.equal(evolutionRecipient({ telefone: PHONE_BR }), '5511999990001')
    assert.equal(evolutionRecipient({ waUserId: LID }), `${LID}@lid`)
    assert.equal(evolutionRecipient({ waUserId: `${LID}@lid` }), `${LID}@lid`)
    assert.equal(evolutionRecipient({ waUserId: LID, telefone: PHONE_BR }), '5511999990001')
  })
  it('LID gravado por engano como telefone continua sendo LID', () => {
    assert.equal(evolutionRecipient({ waUserId: LID, telefone: `+${LID}` }), `${LID}@lid`)
  })
  it('telefones estrangeiros: só dígitos, sem acrescentar o 55', () => {
    assert.equal(evolutionRecipient({ telefone: PHONE_MX }), '5215512345678')
    assert.equal(evolutionRecipient({ telefone: PHONE_AR }), '5491155550003')
    assert.equal(evolutionRecipient({ telefone: PHONE_US }), '14155550004')
    assert.equal(evolutionRecipient({ telefone: PHONE_BR8 }), '551188880002')
  })
  it('sem nada (ou BSUID da Meta): erro legível', () => {
    assert.throws(() => evolutionRecipient({}), new RegExp(NO_RECIPIENT))
    assert.throws(() => evolutionRecipient({ waUserId: 'BR.abc123' }), new RegExp(NO_RECIPIENT))
    assert.equal(lidDigits('BR.abc123'), null)
  })
})

describe('EvolutionProvider.sendText contra a Evolution falsa', () => {
  const p = new EvolutionProvider()
  it('LID-only vai como <lid>@lid e é aceito', async () => {
    hits.length = 0
    const r = await p.sendText('w1', { waUserId: LID }, 'oi')
    assert.match(r.providerMessageId, /^FAKE/)
    assert.equal(hits[0].number, `${LID}@lid`)
  })
  it('telefones (BR com e sem 9º dígito, MX, AR, US) vão só com dígitos, sem 55 extra', async () => {
    hits.length = 0
    for (const t of [PHONE_BR, PHONE_BR8, PHONE_MX, PHONE_AR, PHONE_US]) await p.sendText('w1', { telefone: t }, 'oi')
    assert.deepEqual(hits.map((h) => h.number), ['5511999990001', '551188880002', '5215512345678', '5491155550003', '14155550004'])
  })
  it('o jeito ANTIGO (LID sem sufixo) seria recusado: falha com motivo legível, sem o número', async () => {
    // Prova o servidor falso: dígitos de LID sem "@lid" = exists:false.
    await assert.rejects(p.sendText('w1', { telefone: `+${LID}` , waUserId: undefined }, 'oi'), (e: any) => {
      assert.match(e.message, /não reconheceu este número/)
      assert.ok(!e.message.includes(LID))
      return true
    })
  })
  it('contato sem número: não chama a Evolution', async () => {
    hits.length = 0
    await assert.rejects(p.sendText('w1', {}, 'oi'), new RegExp(NO_RECIPIENT))
    assert.equal(hits.length, 0)
  })
})

// ---------------------------------------------------------------- Recebimento + envio + falha gravada

describe('banco: contato LID, envio e failReason', () => {
  it('mensagem de LID sem telefone cria contato SEM telefone (o LID fica em waUserId); o nome do perfil entra depois', async () => {
    const ws = await newWorkspace()
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID }, body: 'hola', providerMessageId: 'M1', timestamp: new Date() })
    let c = await db.contact.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(c.telefone, null)
    assert.equal(c.waUserId, LID)
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID }, nome: 'María', body: 'otra', providerMessageId: 'M2', timestamp: new Date() })
    c = await db.contact.findFirstOrThrow({ where: { workspaceId: ws } })
    assert.equal(c.nome, 'María')
  })

  it('o mesmo cliente por LID e depois por LID+telefone: completa o telefone no contato do LID (sem duplicar)', async () => {
    const ws = await newWorkspace()
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID2 }, body: 'a', providerMessageId: 'A1', timestamp: new Date() })
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID2, telefone: PHONE_MX }, body: 'b', providerMessageId: 'A2', timestamp: new Date() })
    const all = await db.contact.findMany({ where: { workspaceId: ws } })
    assert.equal(all.length, 1)
    assert.equal(all[0].telefone, PHONE_MX)
    assert.equal(all[0].waUserId, LID2)
  })

  it('o telefone já é de OUTRO contato e o evento traz LID + telefone (prova): unifica sem perder mensagem (onda 2, contacts/merge.ts)', async () => {
    const ws = await newWorkspace()
    await ingestInboundMessage({ workspaceId: ws, from: { telefone: PHONE_US }, body: 'a', providerMessageId: 'B1', timestamp: new Date() })
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID }, body: 'b', providerMessageId: 'B2', timestamp: new Date() })
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID, telefone: PHONE_US }, body: 'c', providerMessageId: 'B3', timestamp: new Date() })
    assert.equal(await db.contact.count({ where: { workspaceId: ws } }), 1)
    assert.equal(await db.message.count({ where: { conversation: { workspaceId: ws } } }), 3)
  })

  it('conflito: o telefone já está ligado a OUTRO LID; a mensagem não se perde e nada é unido às cegas', async () => {
    const ws = await newWorkspace()
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID2, telefone: PHONE_US }, body: 'a', providerMessageId: 'E1', timestamp: new Date() })
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID }, body: 'b', providerMessageId: 'E2', timestamp: new Date() })
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: LID, telefone: PHONE_US }, body: 'c', providerMessageId: 'E3', timestamp: new Date() })
    assert.equal(await db.contact.count({ where: { workspaceId: ws } }), 2)
    assert.equal(await db.message.count({ where: { conversation: { workspaceId: ws } } }), 3)
  })

  it('envio da IA/app para contato LID-only: ENVIADA para <lid>@lid; falha grava failReason legível', async () => {
    const ws = await newWorkspace()
    process.env.WA_MOCK = 'false'
    try {
      const c = await findOrCreateContact(ws, { waUserId: LID }, undefined)
      const conv = await db.conversation.create({ data: { workspaceId: ws, contactId: c.id } })
      hits.length = 0
      const ok = await sendAndRecord({ session: { workspaceId: ws, kind: 'rapida', official: false }, conversationId: conv.id, to: { waUserId: LID }, author: 'IA', content: { kind: 'text', text: 'hola' }, emit: false })
      assert.equal(ok.status, 'ENVIADA')
      assert.equal(hits[0].number, `${LID}@lid`)

      ev.force = 503
      await assert.rejects(sendAndRecord({ session: { workspaceId: ws, kind: 'rapida', official: false }, conversationId: conv.id, to: { waUserId: LID }, author: 'IA', content: { kind: 'text', text: 'otra' }, emit: false }))
      ev.force = 0
      const falhou = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, status: 'FALHOU' } })
      assert.equal(falhou.failReason, 'Evolution API respondeu 503')

      await assert.rejects(sendAndRecord({ session: { workspaceId: ws, kind: 'rapida', official: false }, conversationId: conv.id, to: {}, author: 'IA', content: { kind: 'text', text: 'x' }, emit: false }))
      const semNumero = await db.message.findMany({ where: { conversationId: conv.id, status: 'FALHOU' }, orderBy: { createdAt: 'desc' } })
      assert.equal(semNumero[0].failReason, NO_RECIPIENT)
    } finally {
      ev.force = 0
      process.env.WA_MOCK = 'true'
    }
  })
})

// ---------------------------------------------------------------- Números brasileiros não regridem

describe('normalização de telefones (sem regressão)', () => {
  it('BR com e sem 9º dígito, +55 explícito e estrangeiros', () => {
    assert.equal(normalizePhone('11999990001'), '+5511999990001')
    assert.equal(normalizePhone('1188880002'), '+551188880002')
    assert.equal(normalizePhone('+55 11 99999-0001'), '+5511999990001')
    assert.equal(normalizePhone('+52 1 55 1234 5678'), '+5215512345678')
    assert.equal(normalizePhone('+54 9 11 5555 0003'), '+5491155550003')
    assert.equal(normalizePhone('+1 415 555 0004'), '+14155550004')
  })
})

// ---------------------------------------------------------------- Pendentes

describe('conversas pendentes', () => {
  it('contato só com LID conta como pendente; sem telefone e sem waUserId (sem destino) não conta', async () => {
    const ws = await newWorkspace()
    const now = new Date()
    const mk = async (d: { telefone?: string; waUserId?: string }) => {
      const c = await db.contact.create({ data: { workspaceId: ws, telefone: d.telefone ?? null, waUserId: d.waUserId ?? null, nome: 'X' } })
      const conv = await db.conversation.create({ data: { workspaceId: ws, contactId: c.id, lastMessageAt: now } })
      await db.message.create({ data: { conversationId: conv.id, direction: 'IN', author: 'CLIENTE', body: 'oi', status: 'ENTREGUE', createdAt: now } })
      return conv.id
    }
    const comTel = await mk({ telefone: PHONE_BR })
    const comLidETel = await mk({ telefone: PHONE_MX, waUserId: LID })
    const soLid = await mk({ waUserId: LID2 })
    const bsuid = await mk({ waUserId: 'BR.abc123' })
    const semDestino = await mk({})
    const ids = (await findPending(ws, { sinceMs: 3_600_000 })).map((r) => r.conversationId).sort()
    assert.deepEqual(ids, [comTel, comLidETel, soLid, bsuid].sort())
    assert.ok(!ids.includes(semDestino))
    assert.equal((await findPending(ws, { sinceMs: 3_600_000, conversationId: soLid })).length, 1)
    assert.equal((await findPending(ws, { sinceMs: 3_600_000, conversationId: semDestino })).length, 0)
  })
})
