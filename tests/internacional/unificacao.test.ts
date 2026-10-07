// Etapa UNIF (onda 2): uma conversa só por cliente quando o mesmo evento traz o LID e o telefone (contacts/merge.ts),
// e o script dos duplicados antigos (scripts/unificar-contatos.ts). Banco de TESTE (pearchat_test_*), motor desligado.
// Rodar: node /tmp/pearchat-pg/test-env.mjs --schema c -- npx tsx --test --test-concurrency=1 tests/internacional/unificacao.test.ts
// LIDs, telefones e nomes inventados (nenhum dado de cliente).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { ingestInboundMessage } from '../../src/server/messages/ingest'
import { encrypt } from '../../src/server/whatsapp/crypto'
import { inboxDedupeKey } from '../../src/server/whatsapp/inbox'
import { main as scriptMain, mascararLid, mascararTelefone } from '../../scripts/unificar-contatos'
import { assertTestSchema, captureEvents, cleanupBiz, createBiz, db, digits, msgsOf, newPhone } from '../_fakes/test-db'

let lidSeq = 0
/** LID inventado (15 dígitos, único por execução). */
const newLid = () => `26${String(Date.now()).slice(-9)}${String(lidSeq++ % 10_000).padStart(4, '0')}`
const ago = (h: number) => new Date(Date.now() - h * 3_600_000)

const orgs: string[] = []
const inboxIds: string[] = []

/** Espaço de teste ligado a uma organização (o AuditLog é por organização). */
async function newSpace() {
  const biz = await createBiz({ enabled: false })
  const org = await db.organization.create({ data: { nome: 'Org teste unificação' } })
  orgs.push(org.id)
  await db.workspace.update({ where: { id: biz.workspaceId }, data: { organizationId: org.id } })
  return biz
}

async function contactWithConv(workspaceId: string, d: { waUserId?: string; telefone?: string; nome: string; createdAt: Date; tags?: string[]; msgs: { id: string; at: Date; body: string }[] }) {
  const c = await db.contact.create({
    data: { workspaceId, waUserId: d.waUserId ?? null, telefone: d.telefone ?? null, nome: d.nome, tags: d.tags ?? [], createdAt: d.createdAt },
  })
  const conv = await db.conversation.create({ data: { workspaceId, contactId: c.id, unread: d.msgs.length, lastMessageAt: d.msgs.at(-1)?.at ?? null, createdAt: d.createdAt } })
  for (const m of d.msgs) {
    await db.message.create({ data: { conversationId: conv.id, direction: 'IN', author: 'CLIENTE', body: m.body, status: 'ENTREGUE', providerMessageId: m.id, createdAt: m.at } })
  }
  return { contact: c, conv }
}

const counts = async (workspaceId: string) => ({
  contatos: await db.contact.count({ where: { workspaceId } }),
  conversas: await db.conversation.count({ where: { workspaceId } }),
  mensagens: await db.message.count({ where: { conversation: { workspaceId } } }),
  auditorias: await db.auditLog.count({ where: { workspaceId, acao: 'contato.unificado' } }),
})

before(async () => {
  await assertTestSchema()
})
after(async () => {
  await db.webhookInbox.deleteMany({ where: { id: { in: inboxIds } } })
  await cleanupBiz()
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgs } } })
  await db.organization.deleteMany({ where: { id: { in: orgs } } })
  await db.$disconnect()
})

describe('unificação no recebimento (LID + telefone no mesmo evento)', () => {
  let ws = ''
  let lid = ''
  let tel = ''

  it('com prova: um contato (o mais antigo), uma conversa com as 4 mensagens em ordem, tudo reapontado, auditoria e tempo real', async () => {
    ;({ workspaceId: ws } = await newSpace())
    lid = newLid()
    tel = newPhone()
    // A: só LID, mais antigo, 2 mensagens (do histórico). B: só telefone, mais novo, 1 mensagem + agenda + disparo + follow-up.
    const A = await contactWithConv(ws, { waUserId: lid, nome: lid, createdAt: ago(72), tags: ['vip'], msgs: [{ id: `A1-${lid}`, at: ago(5), body: 'a1' }, { id: `A2-${lid}`, at: ago(4), body: 'a2' }] })
    const B = await contactWithConv(ws, { telefone: tel, nome: 'Carla Teste', createdAt: ago(24), tags: ['novo'], msgs: [{ id: `B1-${lid}`, at: ago(3), body: 'b1' }] })
    const ev = await db.event.create({ data: { workspaceId: ws, contactId: B.contact.id, inicio: ago(-24), duracaoMin: 30, titulo: 'Consulta', tipo: 'Consulta', origem: 'MANUAL' } })
    const camp = await db.campaign.create({ data: { workspaceId: ws, lista: 'todos', mensagem: 'oi', intervaloMin: 1, intervaloMax: 2, status: 'concluida', total: 1 } })
    const rec = await db.campaignRecipient.create({ data: { campaignId: camp.id, contactId: B.contact.id, status: 'enviado', sentAt: ago(6) } })
    const fu = await db.followUpJob.create({ data: { conversationId: B.conv.id, tentativa: 1, runAt: ago(-2), status: 'pendente' } })
    const owner = await db.user.findFirstOrThrow({ where: { workspaceId: ws } })
    const notif = await db.notification.create({
      data: { userId: owner.id, workspaceId: ws, tipo: 'nova_conversa', titulo: 'x', link: `/whatsapp?c=${B.conv.id}`, refIds: { ids: [B.conv.id], nomes: [], motivos: {}, extra: 0 }, dedupeKey: `t:${B.conv.id}`, ocorridoEm: ago(1) },
    })

    const events = captureEvents()
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: lid, telefone: tel }, nome: 'Carla', body: 'c1', providerMessageId: `C1-${lid}`, timestamp: new Date() })

    const all = await db.contact.findMany({ where: { workspaceId: ws } })
    assert.equal(all.length, 1, 'um contato só')
    const kept = all[0]
    assert.equal(kept.id, A.contact.id, 'fica o mais antigo')
    assert.equal(kept.waUserId, lid)
    assert.equal(kept.telefone, tel)
    assert.equal(kept.nome, 'Carla Teste', 'nome de verdade vence o LID')
    assert.deepEqual([...kept.tags].sort(), ['novo', 'vip'])

    const convs = await db.conversation.findMany({ where: { workspaceId: ws } })
    assert.equal(convs.length, 1, 'uma conversa só')
    assert.equal(convs[0].id, A.conv.id)
    assert.deepEqual((await msgsOf(A.conv.id)).map((m) => m.body), ['a1', 'a2', 'b1', 'c1'], 'as 4 mensagens, em ordem')
    assert.equal(convs[0].unread, 4)

    assert.equal((await db.event.findUniqueOrThrow({ where: { id: ev.id } })).contactId, kept.id, 'evento da agenda reapontado')
    assert.equal((await db.campaignRecipient.findUniqueOrThrow({ where: { id: rec.id } })).contactId, kept.id, 'destinatário do disparo reapontado')
    const fuAfter = await db.followUpJob.findUniqueOrThrow({ where: { id: fu.id } })
    assert.equal(fuAfter.conversationId, A.conv.id, 'follow-up reapontado')
    const n = await db.notification.findUniqueOrThrow({ where: { id: notif.id } })
    assert.equal(n.link, `/whatsapp?c=${A.conv.id}`)
    assert.deepEqual((n.refIds as { ids: string[] }).ids, [A.conv.id])
    assert.equal(await db.contact.findUnique({ where: { id: B.contact.id } }), null, 'duplicado apagado')

    const audits = await db.auditLog.findMany({ where: { workspaceId: ws, acao: 'contato.unificado' } })
    assert.equal(audits.length, 1)
    const meta = JSON.stringify(audits[0].meta)
    assert.ok(meta.includes(B.contact.id) && meta.includes(A.contact.id))
    assert.ok(!meta.includes(digits(tel)) && !meta.includes(lid) && !meta.includes('Carla'), 'auditoria sem telefone, LID ou nome')

    const merged = events.find((e) => e.event === 'conversation.merged')
    assert.deepEqual(merged?.payload, { workspaceId: ws, removedConversationId: B.conv.id, conversationId: A.conv.id })
    assert.ok(events.some((e) => e.event === 'conversation.updated' && (e.payload as { conversation: { id: string } }).conversation.id === A.conv.id))
  })

  it('idempotente: repetir o evento (e mandar outro igual) não cria nem apaga nada', async () => {
    const before = await counts(ws)
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: lid, telefone: tel }, body: 'c1', providerMessageId: `C1-${lid}`, timestamp: new Date() })
    assert.deepEqual(await counts(ws), before)
    await ingestInboundMessage({ workspaceId: ws, from: { waUserId: lid, telefone: tel }, body: 'c2', providerMessageId: `C2-${lid}`, timestamp: new Date() })
    assert.deepEqual(await counts(ws), { ...before, mensagens: before.mensagens + 1 })
  })

  it('sem prova (evento só com telefone): nada é unido', async () => {
    const { workspaceId } = await newSpace()
    const l = newLid()
    const t = newPhone()
    await contactWithConv(workspaceId, { waUserId: l, nome: l, createdAt: ago(48), msgs: [{ id: `S1-${l}`, at: ago(3), body: 'x' }] })
    const B = await contactWithConv(workspaceId, { telefone: t, nome: 'Outro', createdAt: ago(24), msgs: [] })
    await ingestInboundMessage({ workspaceId, from: { telefone: t }, body: 'y', providerMessageId: `S2-${l}`, timestamp: new Date() })
    const c = await counts(workspaceId)
    assert.deepEqual(c, { contatos: 2, conversas: 2, mensagens: 2, auditorias: 0 })
    assert.equal((await msgsOf(B.conv.id)).length, 1, 'a mensagem foi para o contato do telefone')
  })

  it('unificação falhou (banco recusou a transação): a mensagem é gravada no contato encontrado, sem erro', async () => {
    const { workspaceId } = await newSpace()
    const l = newLid()
    const t = newPhone()
    const A = await contactWithConv(workspaceId, { waUserId: l, nome: l, createdAt: ago(48), msgs: [] })
    await contactWithConv(workspaceId, { telefone: t, nome: 'Falha', createdAt: ago(24), msgs: [] })
    const holder = db as unknown as { $transaction: (...a: unknown[]) => unknown }
    const original = holder.$transaction
    holder.$transaction = (...a: unknown[]) => (typeof a[0] === 'function' ? Promise.reject(new Error('banco fora (simulado)')) : original.apply(db, a))
    try {
      await ingestInboundMessage({ workspaceId, from: { waUserId: l, telefone: t }, body: 'f1', providerMessageId: `F1-${l}`, timestamp: new Date() })
    } finally {
      holder.$transaction = original
    }
    assert.deepEqual(await counts(workspaceId), { contatos: 2, conversas: 2, mensagens: 1, auditorias: 0 })
    assert.deepEqual((await msgsOf(A.conv.id)).map((m) => m.body), ['f1'])
  })

  it('concorrência: dois webhooks do mesmo cliente ao mesmo tempo -> um contato, uma conversa, as duas mensagens, sem erro', async () => {
    const { workspaceId } = await newSpace()
    const l = newLid()
    const t = newPhone()
    await contactWithConv(workspaceId, { waUserId: l, nome: l, createdAt: ago(48), msgs: [{ id: `P0-${l}`, at: ago(3), body: 'p0' }] })
    await contactWithConv(workspaceId, { telefone: t, nome: 'Paralelo', createdAt: ago(24), msgs: [] })
    await Promise.all([
      ingestInboundMessage({ workspaceId, from: { waUserId: l, telefone: t }, body: 'p1', providerMessageId: `P1-${l}`, timestamp: new Date() }),
      ingestInboundMessage({ workspaceId, from: { waUserId: l, telefone: t }, body: 'p2', providerMessageId: `P2-${l}`, timestamp: new Date() }),
    ])
    const c = await counts(workspaceId)
    assert.deepEqual(c, { contatos: 1, conversas: 1, mensagens: 3, auditorias: 1 })
    const conv = await db.conversation.findFirstOrThrow({ where: { workspaceId } })
    assert.deepEqual((await msgsOf(conv.id)).map((m) => m.body).sort(), ['p0', 'p1', 'p2'])
  })
})

describe('scripts/unificar-contatos.ts', () => {
  it('máscaras: telefone e LID parciais', () => {
    assert.equal(mascararTelefone('+5511987654321'), '+55 11 9****-**21')
    assert.equal(mascararLid('264900000000556'), '2649…556')
  })

  it('dry-run lista só os pares com prova (mascarados) e os sem prova; --apply unifica; de novo não há nada', async () => {
    const { workspaceId, instance } = await newSpace()
    // Par 1: provado por um evento bruto guardado na caixa de webhooks (LID + remoteJidAlt no mesmo evento).
    const l1 = newLid()
    const t1 = newPhone()
    const A1 = await contactWithConv(workspaceId, { waUserId: l1, nome: l1, createdAt: ago(48), msgs: [{ id: `H1-${l1}`, at: ago(30), body: 'h1' }] })
    const B1 = await contactWithConv(workspaceId, { telefone: t1, nome: 'Par um', createdAt: ago(24), msgs: [{ id: `H2-${l1}`, at: ago(20), body: 'h2' }] })
    const raw = JSON.stringify({
      event: 'messages.upsert',
      instance,
      data: { key: { remoteJid: `${l1}@lid`, remoteJidAlt: `${digits(t1)}@s.whatsapp.net`, fromMe: false, id: `H2-${l1}` }, pushName: 'Par um', message: { conversation: 'h2' }, messageTimestamp: Math.floor(ago(20).getTime() / 1000) },
    })
    const row = await db.webhookInbox.create({ data: { provider: 'evolution', dedupeKey: inboxDedupeKey(raw), payload: encrypt(raw), processedAt: new Date() } })
    inboxIds.push(row.id)
    // Par 2: provado pela MESMA mensagem do WhatsApp gravada nas duas conversas (a repetida mais nova é descartada).
    const l2 = newLid()
    const t2 = newPhone()
    const A2 = await contactWithConv(workspaceId, { waUserId: l2, nome: l2, createdAt: ago(40), msgs: [{ id: `D1-${l2}`, at: ago(10), body: 'd1' }] })
    const B2 = await contactWithConv(workspaceId, { telefone: t2, nome: 'Par dois', createdAt: ago(41), msgs: [{ id: `D1-${l2}`, at: ago(9), body: 'd1' }, { id: `D2-${l2}`, at: ago(8), body: 'd2' }] })
    // Sem prova: um contato só com LID e outro só com telefone, nada que os ligue.
    const l3 = newLid()
    const t3 = newPhone()
    await contactWithConv(workspaceId, { waUserId: l3, nome: l3, createdAt: ago(30), msgs: [{ id: `N1-${l3}`, at: ago(7), body: 'n1' }] })
    await contactWithConv(workspaceId, { telefone: t3, nome: 'Sem prova', createdAt: ago(30), msgs: [] })

    const before = await counts(workspaceId)
    const out: string[] = []
    assert.equal(await scriptMain(['--workspace', workspaceId], (s) => out.push(s)), 0)
    const text = out.join('\n')
    assert.match(text, /--dry-run/)
    assert.match(text, /Pares COM prova \(unificáveis\): 2/)
    assert.match(text, /evento do webhook com LID e telefone/)
    assert.match(text, /1 mensagem\(ns\) com o mesmo id do WhatsApp/)
    assert.match(text, /Não unificável automaticamente .*: 1/)
    assert.ok(text.includes(mascararLid(l3)))
    for (const secret of [digits(t1), digits(t2), digits(t3), l1, l2, l3, 'Par um', 'Par dois', 'Sem prova']) assert.ok(!text.includes(secret), 'saída mascarada, sem nomes')
    assert.deepEqual(await counts(workspaceId), before, 'dry-run não muda nada')

    // A linha de comando de verdade (mesmo banco de teste): também só lista.
    const cli = spawnSync('npx', ['tsx', 'scripts/unificar-contatos.ts', '--workspace', workspaceId], { encoding: 'utf8', env: process.env, timeout: 120_000 })
    assert.equal(cli.status, 0, cli.stderr)
    assert.match(cli.stdout, /Pares COM prova \(unificáveis\): 2/)
    assert.deepEqual(await counts(workspaceId), before)

    out.length = 0
    assert.equal(await scriptMain(['--apply', '--workspace', workspaceId], (s) => out.push(s)), 0)
    const after1 = await counts(workspaceId)
    assert.deepEqual(after1, { contatos: before.contatos - 2, conversas: before.conversas - 2, mensagens: before.mensagens - 1, auditorias: 2 })
    // Par 1: A1 mais antigo fica com o telefone; Par 2: B2 (mais antigo) fica com o LID e a mensagem repetida mais nova sai.
    const k1 = await db.contact.findUniqueOrThrow({ where: { id: A1.contact.id } })
    assert.equal(k1.telefone, t1)
    assert.equal(await db.contact.findUnique({ where: { id: B1.contact.id } }), null)
    assert.deepEqual((await msgsOf(A1.conv.id)).map((m) => m.body), ['h1', 'h2'])
    const k2 = await db.contact.findUniqueOrThrow({ where: { id: B2.contact.id } })
    assert.equal(k2.waUserId, l2)
    assert.equal(await db.contact.findUnique({ where: { id: A2.contact.id } }), null)
    const m2 = await msgsOf(B2.conv.id)
    assert.deepEqual(m2.map((m) => m.body), ['d1', 'd2'])
    assert.ok(m2[0].createdAt < ago(9.5), 'das duas cópias da mesma mensagem, ficou a mais antiga')
    const metaScript = (await db.auditLog.findMany({ where: { workspaceId, acao: 'contato.unificado' } })).map((a) => (a.meta as { origem: string; mensagensDescartadas: number }))
    assert.ok(metaScript.every((m) => m.origem === 'script'))
    assert.ok(metaScript.some((m) => m.mensagensDescartadas === 1))

    out.length = 0
    await scriptMain(['--apply', '--workspace', workspaceId], (s) => out.push(s))
    assert.match(out.join('\n'), /Pares COM prova \(unificáveis\): 0/)
    assert.deepEqual(await counts(workspaceId), after1, 'rodar de novo não muda nada')
  })
})
