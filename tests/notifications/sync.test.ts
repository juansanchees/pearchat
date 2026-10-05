// Sininho: testes do serviço contra o schema de teste (pearchat_test_e). Uso (pelo lançador):
//   node .claude/tmp/sininho/test-env.mjs npx tsx --test tests/notifications/sync.test.ts
import { cleanup, contar, db, makeWorld, ago, amanha, diaSp, seedAiJob, seedConv, seedEvent, uniq } from './fixtures'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { PLANS } from '../../src/lib/plans'
import { spMonthKey } from '../../src/server/calendar/time'
import { HANDOFF_BILLING_NOTE, HANDOFF_LIMIT_NOTE, HANDOFF_MODEL_NOTE } from '../../src/server/engine/handoff-reasons'
import { nomesResumo, quandoAgenda, resumoAusente } from '../../src/server/notifications/format'
import { limitar } from '../../src/server/notifications/http'
import { clearNotifications, deleteNotification, heartbeat, listNotifications, markRead, parseCursor, purgeExpired, syncNotifications } from '../../src/server/notifications/service'
import type { Contexto } from '../../src/server/notifications/service'
import type { NotificationDTO } from '../../src/server/notifications/types'

after(cleanup)

const sync = (ctx: Contexto, now: Date, o: { visivel?: boolean; tela?: 'conversas' | 'agenda' | 'contatos' | 'outra' } = {}) =>
  syncNotifications(ctx, { visivel: o.visivel ?? true, tela: o.tela ?? 'outra', now })
const porTipo = (itens: NotificationDTO[], tipo: string) => itens.filter((i) => i.tipo === tipo)
const um = (itens: NotificationDTO[], tipo: string): NotificationDTO => {
  const l = porTipo(itens, tipo)
  assert.equal(l.length, 1, `esperava 1 item de ${tipo}, vieram ${l.length}: ${JSON.stringify(itens.map((i) => i.tipo))}`)
  return l[0]
}

/** Contato (sem conversa) para agendamentos. */
async function contato(workspaceId: string, nome: string) {
  return db.contact.create({ data: { workspaceId, nome, telefone: `+55119${Math.floor(Math.random() * 1e8)}${uniq().slice(0, 1).charCodeAt(0) % 10}` } })
}

/** Semeia um espaço com um exemplo de cada tipo de acontecimento (tudo dentro das últimas 24 h). */
async function semearTudo(w: Awaited<ReturnType<typeof makeWorld>>, agora: number) {
  const ws = w.w1.id
  await db.whatsAppSession.create({ data: { workspaceId: ws, status: 'CONECTADO', connectedAt: ago(500, agora) } })
  // IA respondeu 3 conversas
  const respondidas: string[] = []
  for (const [i, nome] of Array.from(['Teresa', 'Pao', 'Lu'].entries())) {
    const { conv } = await seedConv(ws, { nome, mode: 'IA', unread: 0, criadaMin: 3000, ultimaMin: 20 - i * 3 }, agora)
    await seedAiJob(ws, conv.id, { runMin: 20 - i * 3 }, agora)
    respondidas.push(conv.id)
  }
  // Passou para a equipe (com motivo)
  const carlos = await seedConv(ws, { nome: 'Carlos', mode: 'HUMANO', unread: 1, criadaMin: 3000, ultimaMin: 8 }, agora)
  await seedAiJob(ws, carlos.conv.id, { runMin: 8, error: 'passagem: quero falar com humano' }, agora)
  // Esperando resposta: duas valem; as outras três não
  const marina = await seedConv(ws, { nome: 'Marina', mode: 'HUMANO', unread: 2, criadaMin: 3000, ultimaMin: 6 }, agora)
  const joana = await seedConv(ws, { nome: 'Joana', mode: null, unread: 1, criadaMin: 3000, ultimaMin: 5 }, agora)
  const ocupada = await seedConv(ws, { nome: 'Ocupada', mode: null, unread: 1, criadaMin: 3000, ultimaMin: 4 }, agora)
  await seedAiJob(ws, ocupada.conv.id, { status: 'pendente', runMin: -1 }, agora) // a IA ainda vai responder
  await seedConv(ws, { nome: 'Importada', mode: 'HUMANO', unread: 3, criadaMin: 3000, ultimaMin: 4, importada: true }, agora)
  await seedConv(ws, { nome: 'DeOutro', mode: 'HUMANO', unread: 1, criadaMin: 3000, ultimaMin: 4, assigneeId: w.admin.id }, agora)
  // Nova conversa (atendida pela IA)
  await seedConv(ws, { nome: 'Nova1', mode: 'IA', unread: 0, criadaMin: 4, ultimaMin: 4 }, agora)
  // Follow-up enviado
  const fu = await seedConv(ws, { nome: 'Fu1', mode: 'IA', criadaMin: 3000, ultimaMin: 700 }, agora)
  await db.followUpJob.create({ data: { conversationId: fu.conv.id, tentativa: 1, runAt: ago(7, agora), status: 'enviado', createdAt: ago(300, agora), updatedAt: ago(7, agora) } })
  // Falhas: 2 da IA + 1 de follow-up, mesmo motivo
  const f1 = await seedConv(ws, { nome: 'F1', mode: 'IA', criadaMin: 3000, ultimaMin: 700 }, agora)
  const f2 = await seedConv(ws, { nome: 'F2', mode: 'IA', criadaMin: 3000, ultimaMin: 700 }, agora)
  await seedAiJob(ws, f1.conv.id, { status: 'erro', error: 'WhatsApp desconectado', runMin: 9 }, agora)
  await seedAiJob(ws, f2.conv.id, { status: 'erro', error: 'WhatsApp desconectado', runMin: 9.5 }, agora)
  await db.followUpJob.create({ data: { conversationId: f1.conv.id, tentativa: 1, runAt: ago(9, agora), status: 'erro', error: 'WhatsApp desconectado', createdAt: ago(300, agora), updatedAt: ago(9, agora) } })
  // Agenda
  const rafael = await contato(ws, 'Rafael Costa')
  const ana = await contato(ws, 'Ana Lima')
  const bia = await contato(ws, 'Bia Equipe')
  const gil = await contato(ws, 'Gil Google')
  const caio = await contato(ws, 'Caio')
  const dani = await contato(ws, 'Dani')
  const edu = await contato(ws, 'Edu')
  const fabi = await seedConv(ws, { nome: 'Fabi', mode: 'IA', criadaMin: 3000, ultimaMin: 700 }, agora)
  await seedEvent(ws, rafael.id, { origem: 'IA', criadoMin: 12 }, agora)
  await seedEvent(ws, ana.id, { origem: 'MANUAL', canal: 'link', criadoMin: 11 }, agora)
  await seedEvent(ws, bia.id, { origem: 'MANUAL', criadoMin: 10 }, agora) // criado pela equipe: sem aviso
  await seedEvent(ws, gil.id, { origem: 'GOOGLE', criadoMin: 10 }, agora) // veio do Google: sem aviso
  await seedEvent(ws, caio.id, { origem: 'IA', criadoMin: 3000, status: 'cancelado', canceladoMin: 13, canceladoPor: 'cliente', atualizadoMin: 13 }, agora)
  await seedEvent(ws, dani.id, { origem: 'IA', criadoMin: 3000, confirmacao: 'confirmado', confirmadoMin: 14, atualizadoMin: 14 }, agora)
  await seedEvent(ws, edu.id, { origem: 'IA', criadoMin: 3000, confirmacao: 'recusado', atualizadoMin: 15 }, agora)
  await seedEvent(ws, fabi.contact.id, { origem: 'IA', criadoMin: 3000, atualizadoMin: 5 }, agora)
  await seedAiJob(ws, fabi.conv.id, { runMin: 5.5, ferramentas: [{ nome: 'remarcar_agendamento', ok: true }] }, agora)
  // Campanha concluída (2 enviadas, 1 falha)
  const camp = await db.campaign.create({ data: { workspaceId: ws, lista: 'Clientes VIP', mensagem: 'MENSAGEM-SECRETA', intervaloMin: 1, intervaloMax: 2, status: 'concluida', total: 3, enviadas: 2, createdAt: ago(60, agora), updatedAt: ago(9, agora) } })
  for (const [i, st] of Array.from(['enviado', 'enviado', 'erro'].entries())) {
    const c = await contato(ws, `Dest ${i}`)
    await db.campaignRecipient.create({ data: { campaignId: camp.id, contactId: c.id, status: st, error: st === 'erro' ? 'falhou' : null } })
  }
  // Convite aceito por "Novo"
  const novo = await db.user.create({ data: { nome: 'Novo Membro', email: `novo-${uniq()}@teste.local`, papel: 'agent', workspaceId: ws, organizationId: w.org.id } })
  await db.invite.create({ data: { organizationId: w.org.id, email: novo.email, papel: 'agent', workspaceIds: [ws], tokenHash: `h-${uniq()}${uniq()}`, expiraEm: ago(-1000, agora), aceitoEm: ago(11, agora) } })
  // Cota de IA: 85 % do limite do plano
  const limite = PLANS.PRO.respostasIa as number
  await db.usageCounter.create({ data: { workspaceId: ws, mes: spMonthKey(new Date(agora)), respostasIa: Math.ceil(limite * 0.85) } })
  return { carlos, marina, joana, respondidas, rafael }
}

describe('tipos de notificação a partir de dados semeados (dono)', () => {
  it('gera cada tipo, agrega, respeita as regras e não vaza texto de mensagem', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const dados = await semearTudo(w, agora)
    const r = await sync(w.ctx(w.owner, w.w1.id), new Date(agora))
    const t = r.itens

    // IA respondeu: agregado, com nomes
    const ia = um(t, 'ia_respondeu')
    assert.equal(ia.titulo, 'A IA respondeu 4 conversas') // Teresa, Pao, Lu e a Fabi (a que a IA remarcou)
    assert.equal(ia.contagem, 4)
    assert.match(ia.corpo ?? '', /^\w+, \w+ e mais 2$/)
    assert.equal(ia.link, '/whatsapp?filtro=com_ia')

    // Passou para a equipe, com motivo e link para a conversa
    const passou = um(t, 'passou_para_voce')
    assert.equal(passou.titulo, 'A IA passou Carlos para a equipe')
    assert.equal(passou.corpo, 'Motivo: quero falar com humano')
    assert.equal(passou.link, `/whatsapp?c=${dados.carlos.conv.id}`)
    assert.equal(passou.prioridade, 'alta')

    // Esperando: Marina e Joana; fora Carlos (passou), Ocupada (IA vai responder), Importada, DeOutro (de outra pessoa)
    const esp = um(t, 'esperando_resposta')
    assert.equal(esp.titulo, '2 conversas esperando você')
    assert.match(esp.corpo ?? '', /Marina/)
    assert.match(esp.corpo ?? '', /Joana/)
    assert.doesNotMatch(esp.corpo ?? '', /Ocupada|Importada|DeOutro|Carlos/)

    // Nova conversa (a que a IA atende): só a Nova1
    const nova = um(t, 'nova_conversa')
    assert.equal(nova.titulo, 'Nova conversa com Nova1')

    // Follow-up
    assert.equal(um(t, 'followup').titulo, 'Follow-up enviado para Fu1')

    // Falhas: 2 jobs da IA + 1 follow-up, motivo mais comum
    const falha = um(t, 'falha_envio')
    assert.equal(falha.titulo, '3 mensagens não foram enviadas')
    assert.equal(falha.corpo, 'Motivo mais comum: WhatsApp desconectado')

    // Agenda: um item por agendamento, no formato do cartão "Novo agendamento"
    const novos = porTipo(t, 'agenda_novo')
    assert.equal(novos.length, 2)
    const rafa = novos.find((n) => n.dados?.cliente === 'Rafael Costa')!
    assert.equal(rafa.titulo, 'Novo agendamento')
    assert.equal(rafa.corpo, 'Rafael Costa · amanhã, 16:00')
    assert.equal(rafa.dados?.origem, 'ia')
    assert.equal(rafa.link, `/agenda?dia=${diaSp(amanha('16:00', new Date(agora)))}`)
    const ana = novos.find((n) => n.dados?.cliente === 'Ana Lima')!
    assert.equal(ana.dados?.origem, 'link')
    assert.equal(um(t, 'agenda_cancelado').titulo, 'Agendamento cancelado')
    assert.equal(um(t, 'agenda_confirmado').titulo, 'Presença confirmada')
    assert.equal(um(t, 'agenda_remarcar').titulo, 'Pediu para remarcar')
    const remarcado = um(t, 'agenda_remarcado')
    assert.equal(remarcado.titulo, 'Agendamento remarcado')
    assert.match(remarcado.corpo ?? '', /^Fabi · /)
    // Agendamento da equipe e do Google não geram aviso
    assert.ok(!t.some((i) => /Bia Equipe|Gil Google/.test(`${i.corpo}${i.dados?.cliente}`)))

    // Só dono/administrador
    const camp = um(t, 'campanha')
    assert.equal(camp.titulo, 'Campanha concluída')
    assert.match(camp.corpo ?? '', /Clientes VIP · 2 enviadas, 1 falha/)
    assert.match(um(t, 'equipe_convite').titulo, /Novo Membro entrou na equipe/)
    const cota = um(t, 'cota_ia')
    assert.equal(cota.titulo, 'Cota de IA perto do limite')

    // Sem texto de mensagem nem da campanha em lugar nenhum; links só de rotas internas
    const todos = JSON.stringify(await db.notification.findMany({ where: { userId: w.owner.id } }))
    assert.doesNotMatch(todos, /SEGREDO|MENSAGEM-SECRETA/)
    for (const i of t) if (i.link) assert.match(i.link, /^\/(whatsapp|agenda)(\?[A-Za-z0-9_=&-]*)?$/, `link fora do padrão: ${i.link}`)
    // Tudo veio como "não presente fora": primeira sincronização não é volta
    assert.ok(t.every((i) => !i.ausente))
    assert.ok(r.naoLidas >= 12)
    assert.equal(r.ausenteDesde, null)
  })

  it('atendente não recebe disparos, equipe nem cota; vê o que é dele', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    await semearTudo(w, agora)
    const r = await sync(w.ctx(w.agent, w.w1.id), new Date(agora))
    for (const tipo of ['campanha', 'equipe_convite', 'cota_ia']) assert.equal(porTipo(r.itens, tipo).length, 0, tipo)
    assert.equal(um(r.itens, 'ia_respondeu').contagem, 4)
    assert.equal(um(r.itens, 'passou_para_voce').prioridade, 'alta')
    assert.equal(porTipo(r.itens, 'agenda_novo').length, 2)
  })

  it('não avisa o usuário do que ele mesmo fez (convite aceito por ele; conversa dele vs de outro)', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    // O convite aceito é do próprio administrador: ele não é avisado (a dona é).
    await db.invite.create({ data: { organizationId: w.org.id, email: w.admin.email, papel: 'admin', workspaceIds: [], tokenHash: `h-${uniq()}${uniq()}`, expiraEm: ago(-1000, agora), aceitoEm: ago(5, agora) } })
    // Conversa atribuída a mim esperando (aviso); atribuída à dona (sem aviso para o admin)
    await seedConv(w.w1.id, { nome: 'MinhaConversa', mode: 'HUMANO', unread: 1, criadaMin: 3000, ultimaMin: 5, assigneeId: w.admin.id }, agora)
    await seedConv(w.w1.id, { nome: 'DaDona', mode: 'HUMANO', unread: 1, criadaMin: 3000, ultimaMin: 5, assigneeId: w.owner.id }, agora)
    const doAdmin = await sync(w.ctx(w.admin, w.w1.id), new Date(agora))
    assert.equal(porTipo(doAdmin.itens, 'equipe_convite').length, 0)
    assert.equal(um(doAdmin.itens, 'esperando_resposta').titulo, 'MinhaConversa está esperando você')
    const daDona = await sync(w.ctx(w.owner, w.w1.id), new Date(agora))
    assert.match(um(daDona.itens, 'equipe_convite').titulo, /entrou na equipe/)
    assert.equal(um(daDona.itens, 'esperando_resposta').titulo, 'DaDona está esperando você')
  })

  it('motivos de passagem: modelo, limite do plano e assinatura inativa', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    for (const [nome, note] of [['A', HANDOFF_MODEL_NOTE], ['B', HANDOFF_LIMIT_NOTE], ['C', HANDOFF_BILLING_NOTE]] as const) {
      const { conv } = await seedConv(w.w1.id, { nome, mode: 'HUMANO', unread: 1, criadaMin: 3000, ultimaMin: 5 }, agora)
      await seedAiJob(w.w1.id, conv.id, { runMin: 5, error: note }, agora)
    }
    const p = um((await sync(w.ctx(w.owner, w.w1.id), new Date(agora))).itens, 'passou_para_voce')
    assert.equal(p.titulo, 'A IA passou 3 conversas para a equipe')
    assert.match(p.corpo ?? '', /A, B e C/)
  })

  it('mais de 5 agendamentos novos no mesmo intervalo: 5 itens próprios + "N agendamentos novos"', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    for (let i = 0; i < 7; i++) {
      const c = await contato(w.w1.id, `Cliente ${i}`)
      await seedEvent(w.w1.id, c.id, { origem: 'IA', criadoMin: 30 - i }, agora)
    }
    const r = await sync(w.ctx(w.owner, w.w1.id), new Date(agora))
    const ag = porTipo(r.itens, 'agenda_novo')
    assert.equal(ag.length, 6)
    assert.equal(ag.filter((a) => a.titulo === 'Novo agendamento').length, 5)
    const resto = ag.find((a) => a.titulo !== 'Novo agendamento')!
    assert.equal(resto.titulo, '2 agendamentos novos')
    assert.equal(resto.link, '/agenda')
  })

  it('cota de IA: avisa 1 vez por nível no mês (mesmo depois de limpar) e de novo ao esgotar', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const ws = w.w1.id
    const limite = PLANS.PRO.respostasIa as number
    await db.whatsAppSession.create({ data: { workspaceId: ws, status: 'CONECTADO', connectedAt: ago(500, agora) } })
    const mes = spMonthKey(new Date(agora))
    await db.usageCounter.create({ data: { workspaceId: ws, mes, respostasIa: Math.ceil(limite * 0.9) } })
    const { conv } = await seedConv(ws, { nome: 'X', mode: 'IA', criadaMin: 3000, ultimaMin: 20 }, agora)
    await seedAiJob(ws, conv.id, { runMin: 20 }, agora)
    const ctx = w.ctx(w.owner, ws)
    let r = await sync(ctx, new Date(agora))
    assert.equal(um(r.itens, 'cota_ia').titulo, 'Cota de IA perto do limite')
    await clearNotifications(ctx)
    // Mais uma resposta da IA depois: continua em 90 %, não repete o aviso (nem depois de limpar)
    await seedAiJob(ws, conv.id, { runMin: -2 }, agora)
    r = await sync(ctx, new Date(agora + 120_000))
    assert.equal(porTipo(r.itens, 'cota_ia').length, 0)
    // Esgotou: aviso novo, de prioridade alta
    await db.usageCounter.update({ where: { workspaceId_mes: { workspaceId: ws, mes } }, data: { respostasIa: limite } })
    await seedAiJob(ws, conv.id, { runMin: -4 }, agora)
    r = await sync(ctx, new Date(agora + 240_000))
    const esgotada = um(r.itens, 'cota_ia')
    assert.equal(esgotada.titulo, 'Cota de IA esgotada')
    assert.equal(esgotada.prioridade, 'alta')
  })
})

describe('WhatsApp: queda e volta', () => {
  it('avisa a queda e a volta (uma vez), e não avisa desconexão feita pela própria pessoa', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    await db.whatsAppSession.create({ data: { workspaceId: ws, status: 'CONECTADO', connectedAt: ago(500, base), numero: '+5511999990000' } })
    const ctx = w.ctx(w.owner, ws)
    // Relógio de teste coerente: o updatedAt da sessão também vai na mesma linha do tempo.
    const min = (n: number) => new Date(base + n * 60_000)
    const mudar = (data: { status: 'CONECTADO' | 'DESCONECTADO'; connectedAt?: Date | null }, quando: Date) =>
      db.whatsAppSession.update({ where: { workspaceId: ws }, data: { ...data, updatedAt: quando } })

    let r = await sync(ctx, min(0)) // aprende o estado "conectado"
    assert.equal(r.itens.filter((i) => i.tipo.startsWith('whatsapp')).length, 0)

    // Queda do aparelho: connectedAt é mantido
    await mudar({ status: 'DESCONECTADO' }, min(0.5))
    r = await sync(ctx, min(1))
    const off = um(r.itens, 'whatsapp_desconectou')
    assert.equal(off.titulo, 'WhatsApp desconectado')
    assert.equal(off.prioridade, 'alta')

    // Sem novidade: não repete
    r = await sync(ctx, min(2))
    assert.equal(porTipo(r.itens, 'whatsapp_desconectou').length, 1)

    // Voltou
    await mudar({ status: 'CONECTADO' }, min(2.5))
    r = await sync(ctx, min(3))
    assert.equal(um(r.itens, 'whatsapp_reconectou').titulo, 'WhatsApp reconectado')

    // Desconexão feita pela pessoa (connectedAt vira nulo): sem aviso de queda nem de volta
    await mudar({ status: 'DESCONECTADO', connectedAt: null }, min(3.5))
    await sync(ctx, min(4))
    await mudar({ status: 'CONECTADO', connectedAt: min(4.5) }, min(4.5))
    r = await sync(ctx, min(5))
    assert.equal(porTipo(r.itens, 'whatsapp_desconectou').length, 1)
    assert.equal(porTipo(r.itens, 'whatsapp_reconectou').length, 1)
  })
})

describe('soma na mesma janela e leitura', () => {
  it('soma na notificação NÃO LIDA do mesmo tipo; lida não recebe soma; conversa repetida conta uma vez', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    const a = await seedConv(ws, { nome: 'Teresa', mode: 'IA', criadaMin: 3000, ultimaMin: 20 }, base)
    await seedAiJob(ws, a.conv.id, { runMin: 20 }, base)
    let r = await sync(ctx, new Date(base))
    const primeira = um(r.itens, 'ia_respondeu')
    assert.equal(primeira.titulo, 'A IA respondeu Teresa')

    const b = await seedConv(ws, { nome: 'Pao', mode: 'IA', criadaMin: 3000, ultimaMin: -1 }, base)
    await seedAiJob(ws, b.conv.id, { runMin: -1 }, base)
    await seedAiJob(ws, a.conv.id, { runMin: -1.2 }, base) // a mesma Teresa de novo: não conta duas vezes
    r = await sync(ctx, new Date(base + 120_000))
    const somada = um(r.itens, 'ia_respondeu')
    assert.equal(somada.id, primeira.id)
    assert.equal(somada.contagem, 2)
    assert.equal(somada.titulo, 'A IA respondeu 2 conversas')
    assert.equal(r.naoLidas, 1)

    // Lê e chega mais uma: vira outra linha
    assert.deepEqual(await markRead(ctx, [somada.id]), { ok: true, alterados: 1 })
    const c = await seedConv(ws, { nome: 'Lu', mode: 'IA', criadaMin: 3000, ultimaMin: -3 }, base)
    await seedAiJob(ws, c.conv.id, { runMin: -3 }, base)
    r = await sync(ctx, new Date(base + 240_000))
    const linhas = porTipo(r.itens, 'ia_respondeu')
    assert.equal(linhas.length, 2)
    assert.equal(linhas.find((l) => l.id === somada.id)!.lida, true)
    assert.equal(linhas.find((l) => l.id !== somada.id)!.titulo, 'A IA respondeu Lu')
  })

  it('"visto ao vivo": na tela de Conversas e presente, as da IA nascem lidas; fora dela continuam não lidas', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const ws = w.w1.id
    const { conv } = await seedConv(ws, { nome: 'Teresa', mode: 'IA', criadaMin: 3000, ultimaMin: 20 }, agora)
    await seedAiJob(ws, conv.id, { runMin: 20 }, agora)
    const { conv: c2 } = await seedConv(ws, { nome: 'Carlos', mode: 'HUMANO', unread: 1, criadaMin: 3000, ultimaMin: 9 }, agora)
    await seedAiJob(ws, c2.id, { runMin: 9, error: 'passagem: humano' }, agora)
    const r = await sync(w.ctx(w.owner, ws), new Date(agora), { tela: 'conversas' })
    assert.equal(um(r.itens, 'ia_respondeu').lida, true)
    assert.equal(um(r.itens, 'passou_para_voce').lida, false) // a passagem para a equipe continua pedindo atenção
    const fora = await sync(w.ctx(w.admin, ws), new Date(agora), { tela: 'agenda' })
    assert.equal(um(fora.itens, 'ia_respondeu').lida, false)
  })
})

describe('"enquanto você esteve fora" e janela de tempo', () => {
  it('batimento velho (> 3 min) marca como ausente só o que veio depois dele, devolve o desde e o resumo', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    await sync(ctx, new Date(base - 30 * 60_000)) // cria o cursor
    const saiu = new Date(base - 10 * 60_000)
    await db.notificationCursor.update({ where: { userId_workspaceId: { userId: ctx.userId, workspaceId: ws } }, data: { ultimaAtividadeEm: saiu } })
    // 15 min atrás (antes de sair) e 5 min atrás (fora)
    const antes = await seedConv(ws, { nome: 'Antes', mode: 'IA', criadaMin: 3000, ultimaMin: 15 }, base)
    await seedAiJob(ws, antes.conv.id, { runMin: 15 }, base)
    for (const [i, n] of Array.from(['Teresa', 'Pao', 'Lu'].entries())) {
      const c = await seedConv(ws, { nome: n, mode: 'IA', criadaMin: 3000, ultimaMin: 5 - i * 0.5 }, base)
      await seedAiJob(ws, c.conv.id, { runMin: 5 - i * 0.5 }, base)
    }
    const c = await contato(ws, 'Rafael Costa')
    await seedEvent(ws, c.id, { origem: 'IA', criadoMin: 4 }, base)
    const r = await sync(ctx, new Date(base))
    assert.equal(r.ausenteDesde, saiu.toISOString())
    assert.equal(r.resumoAusente, 'A IA respondeu 3 conversas e há 1 agendamento novo')
    const fora = r.itens.filter((i) => i.ausente)
    assert.equal(fora.length, 2)
    assert.ok(fora.every((i) => i.dados?.ausenteDesde === saiu.toISOString()))
    const presente = r.itens.filter((i) => !i.ausente)
    assert.equal(presente.length, 1)
    assert.equal(presente[0].titulo, 'A IA respondeu Antes')
    // Já voltou: o próximo sync não é "volta"
    const de_novo = await sync(ctx, new Date(base + 60_000))
    assert.equal(de_novo.ausenteDesde, null)
    assert.equal(de_novo.resumoAusente, null)
  })

  it('com batimento recente nada é "ausente"; o batimento só atualiza a presença', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    await sync(ctx, new Date(base - 30 * 60_000))
    await db.notificationCursor.update({ where: { userId_workspaceId: { userId: ctx.userId, workspaceId: ws } }, data: { ultimaAtividadeEm: new Date(base - 10 * 60_000) } })
    await heartbeat(ctx, new Date(base - 60_000)) // bateu há 1 min
    const c = await seedConv(ws, { nome: 'Teresa', mode: 'IA', criadaMin: 3000, ultimaMin: 5 }, base)
    await seedAiJob(ws, c.conv.id, { runMin: 5 }, base)
    const r = await sync(ctx, new Date(base))
    assert.equal(r.ausenteDesde, null)
    assert.ok(r.itens.every((i) => !i.ausente))
    // Sem cursor, o batimento não cria nada
    const outro = w.ctx(w.admin, ws)
    await heartbeat(outro)
    assert.equal(await db.notificationCursor.count({ where: { userId: outro.userId } }), 0)
  })

  it('aba oculta (visivel=false) não conta como presença', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ctx = w.ctx(w.owner, w.w1.id)
    await sync(ctx, new Date(base - 20 * 60_000))
    const antes = await db.notificationCursor.findUniqueOrThrow({ where: { userId_workspaceId: { userId: ctx.userId, workspaceId: ctx.workspaceId } } })
    await sync(ctx, new Date(base), { visivel: false })
    const depois = await db.notificationCursor.findUniqueOrThrow({ where: { userId_workspaceId: { userId: ctx.userId, workspaceId: ctx.workspaceId } } })
    assert.equal(depois.ultimaAtividadeEm.getTime(), antes.ultimaAtividadeEm.getTime())
    assert.ok(depois.sincronizadoAte.getTime() > antes.sincronizadoAte.getTime())
  })

  it('primeira sincronização olha no máximo 24 h; depois nunca mais que 7 dias', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const mk = async (nome: string, min: number) => {
      const { conv } = await seedConv(ws, { nome, mode: 'IA', criadaMin: 20000, ultimaMin: min }, base)
      await seedAiJob(ws, conv.id, { runMin: min }, base)
    }
    await mk('H30', 30 * 60) // 30 h atrás: fora
    await mk('H20', 20 * 60) // 20 h atrás: dentro
    const ctx = w.ctx(w.owner, ws)
    const r = await sync(ctx, new Date(base))
    assert.equal(um(r.itens, 'ia_respondeu').titulo, 'A IA respondeu H20')

    // Volta depois de 10 dias parado: olha só os últimos 7
    const ctx2 = w.ctx(w.admin, ws)
    await sync(ctx2, new Date(base - 10 * 24 * 3_600_000))
    await mk('D8', 8 * 24 * 60) // 8 dias atrás: fora
    await mk('D6', 6 * 24 * 60) // 6 dias atrás: dentro
    const r2 = await sync(ctx2, new Date(base))
    const nomes = r2.itens.filter((i) => i.tipo === 'ia_respondeu').map((i) => `${i.titulo}|${i.corpo ?? ''}`).join(' ')
    // O administrador nunca sincronizou nos últimos 10 dias: a janela dele é de 7 dias (só D8 fica de fora).
    assert.match(nomes, /H20/)
    assert.match(nomes, /H30/)
    assert.match(nomes, /D6/)
    assert.doesNotMatch(nomes, /D8/)
  })

  it('resposta da IA ainda em andamento segura a janela: aparece só depois de terminar', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    await sync(ctx, new Date(base - 5 * 60_000))
    const { conv } = await seedConv(ws, { nome: 'Teresa', mode: 'IA', criadaMin: 3000, ultimaMin: 1 }, base)
    const job = await seedAiJob(ws, conv.id, { status: 'executando', runMin: 1 }, base)
    let r = await sync(ctx, new Date(base))
    assert.equal(porTipo(r.itens, 'ia_respondeu').length, 0)
    await db.aiJob.update({ where: { id: job.id }, data: { status: 'feito', error: null } })
    r = await sync(ctx, new Date(base + 60_000))
    assert.equal(um(r.itens, 'ia_respondeu').titulo, 'A IA respondeu Teresa')
  })
})

describe('idempotência e concorrência', () => {
  it('três sincronizações simultâneas (duas abas e mais uma) gravam cada coisa uma vez', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    await db.whatsAppSession.create({ data: { workspaceId: ws, status: 'CONECTADO', connectedAt: ago(500, base) } })
    await sync(ctx, new Date(base - 20 * 60_000))
    for (const n of ['Teresa', 'Pao']) {
      const { conv } = await seedConv(ws, { nome: n, mode: 'IA', criadaMin: 3000, ultimaMin: 5 }, base)
      await seedAiJob(ws, conv.id, { runMin: 5 }, base)
    }
    const c = await contato(ws, 'Rafael Costa')
    await seedEvent(ws, c.id, { origem: 'IA', criadoMin: 4 }, base)
    const now = new Date(base)
    await Promise.all([sync(ctx, now), sync(ctx, now), sync(ctx, now)])
    const rows = await db.notification.findMany({ where: { userId: ctx.userId, workspaceId: ws } })
    assert.equal(rows.filter((x) => x.tipo === 'ia_respondeu').length, 1)
    assert.equal(rows.find((x) => x.tipo === 'ia_respondeu')!.contagem, 2)
    assert.equal(rows.filter((x) => x.tipo === 'agenda_novo').length, 1)
    // Uma quarta, depois, não acha nada de novo
    const de_novo = await sync(ctx, new Date(base + 60_000))
    assert.equal(de_novo.naoLidas, 2)
  })

  it('primeira sincronização simultânea (cursor ainda não existe) também não duplica', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const c = await contato(ws, 'Rafael Costa')
    await seedEvent(ws, c.id, { origem: 'IA', criadoMin: 4 }, base)
    const ctx = w.ctx(w.owner, ws)
    await Promise.all([sync(ctx, new Date(base)), sync(ctx, new Date(base))])
    assert.equal(await db.notification.count({ where: { userId: ctx.userId, workspaceId: ws, tipo: 'agenda_novo' } }), 1)
  })
})

describe('isolamento', () => {
  it('cada usuário tem a sua leitura; cada espaço o seu histórico; outra organização não enxerga nem mexe', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    await semearTudo(w, agora)
    const dona = w.ctx(w.owner, w.w1.id)
    const admin = w.ctx(w.admin, w.w1.id)
    const rd = await sync(dona, new Date(agora))
    const ra = await sync(admin, new Date(agora))
    assert.ok(rd.naoLidas > 0 && ra.naoLidas > 0)
    // A dona lê tudo: o administrador continua com as dele
    await markRead(dona)
    assert.equal((await listNotifications(dona)).naoLidas, 0)
    assert.equal((await listNotifications(admin)).naoLidas, ra.naoLidas)

    // Outro espaço da mesma organização: sem nada (os dados são do W1)
    const dona2 = w.ctx(w.owner, w.w2.id)
    const r2 = await sync(dona2, new Date(agora))
    assert.equal(r2.itens.length, 0)
    assert.equal((await listNotifications(dona2)).itens.length, 0)

    // Outra organização: nada do W1, e ids alheios dão "não encontrada" (sem efeito)
    const intruso = w.ctx(w.intruso, w.w3.id, w.orgB.id)
    const ri = await sync(intruso, new Date(agora))
    assert.equal(ri.itens.length, 0)
    const alheio = rd.itens[0].id
    assert.deepEqual(await markRead(intruso, [alheio]), { ok: false, motivo: 'nao_encontrada' })
    assert.deepEqual(await deleteNotification(intruso, alheio), { ok: false, motivo: 'nao_encontrada' })
    assert.deepEqual(await deleteNotification(admin, alheio), { ok: false, motivo: 'nao_encontrada' }) // de outra PESSOA no mesmo espaço
    assert.deepEqual(await markRead(dona2, [alheio]), { ok: false, motivo: 'nao_encontrada' }) // do mesmo usuário, mas de OUTRO espaço
    assert.equal(await db.notification.count({ where: { id: alheio, apagadaEm: null } }), 1)
    // Uma id alheia no meio de uma lista: nenhuma é alterada
    const minhas = (await listNotifications(admin)).itens.slice(0, 2).map((i) => i.id)
    const antes = (await listNotifications(admin)).naoLidas
    assert.deepEqual(await markRead(admin, [...minhas, alheio]), { ok: false, motivo: 'nao_encontrada' })
    assert.equal((await listNotifications(admin)).naoLidas, antes)
    // Limpar o histórico de um não limpa o do outro
    await clearNotifications(intruso)
    assert.equal((await listNotifications(admin)).itens.length > 0, true)
  })

  it('cada espaço da organização tem o seu próprio cursor e histórico', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const { conv } = await seedConv(w.w2.id, { nome: 'DaFilial', mode: 'IA', criadaMin: 3000, ultimaMin: 5 }, agora)
    await seedAiJob(w.w2.id, conv.id, { runMin: 5 }, agora)
    const naLoja = await sync(w.ctx(w.owner, w.w1.id), new Date(agora))
    const naFilial = await sync(w.ctx(w.owner, w.w2.id), new Date(agora))
    assert.equal(porTipo(naLoja.itens, 'ia_respondeu').length, 0)
    assert.equal(um(naFilial.itens, 'ia_respondeu').titulo, 'A IA respondeu DaFilial')
    assert.equal(await db.notificationCursor.count({ where: { userId: w.owner.id } }), 2)
  })
})

describe('histórico: ler, apagar, limpar e vencer', () => {
  it('apagar uma, limpar tudo e o que foi apagado não reaparece (nem com o cursor recuado); a marca não guarda conteúdo', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    const c = await contato(ws, 'Rafael Costa')
    await seedEvent(ws, c.id, { origem: 'IA', criadoMin: 4 }, agora)
    const { conv } = await seedConv(ws, { nome: 'Teresa', mode: 'IA', criadaMin: 3000, ultimaMin: 5 }, agora)
    await seedAiJob(ws, conv.id, { runMin: 5 }, agora)
    const r = await sync(ctx, new Date(agora))
    assert.equal(r.itens.length, 2)

    const ag = um(r.itens, 'agenda_novo')
    assert.deepEqual(await deleteNotification(ctx, ag.id), { ok: true, alterados: 1 })
    assert.deepEqual(await deleteNotification(ctx, ag.id), { ok: false, motivo: 'nao_encontrada' }) // já apagada
    assert.equal((await listNotifications(ctx)).itens.length, 1)
    const marca = await db.notification.findUniqueOrThrow({ where: { id: ag.id } })
    assert.equal(marca.titulo, '')
    assert.equal(marca.corpo, null)
    assert.equal(marca.link, null)
    assert.equal(marca.dados, null)
    assert.ok(marca.apagadaEm)

    assert.equal(await clearNotifications(ctx), 1)
    assert.equal((await listNotifications(ctx)).itens.length, 0)
    assert.equal((await listNotifications(ctx)).naoLidas, 0)

    // Próxima sincronização: nada volta
    assert.equal((await sync(ctx, new Date(agora + 120_000))).itens.length, 0)
    // Mesmo que o cursor recuasse (nunca acontece), o aviso de agenda já apagado não renasce (a chave fica como marca)
    await db.notificationCursor.update({ where: { userId_workspaceId: { userId: ctx.userId, workspaceId: ws } }, data: { sincronizadoAte: new Date(agora - 3_600_000) } })
    const r3 = await sync(ctx, new Date(agora + 240_000))
    assert.equal(porTipo(r3.itens, 'agenda_novo').length, 0)
  })

  it('ler: todas e uma lista; a lista vazia não faz nada', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    await semearTudo(w, agora)
    const ctx = w.ctx(w.owner, w.w1.id)
    const r = await sync(ctx, new Date(agora))
    const [a, b] = r.itens
    assert.deepEqual(await markRead(ctx, [a.id, b.id, a.id]), { ok: true, alterados: 2 })
    assert.equal((await listNotifications(ctx)).naoLidas, r.naoLidas - 2)
    assert.deepEqual(await markRead(ctx, []), { ok: true, alterados: 0 })
    const todas = await markRead(ctx)
    assert.ok(todas.ok && todas.alterados === r.naoLidas - 2)
    assert.equal((await listNotifications(ctx)).naoLidas, 0)
  })

  it('paginação por cursor traz tudo, sem repetir', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    await semearTudo(w, agora)
    const ctx = w.ctx(w.owner, w.w1.id)
    const r = await sync(ctx, new Date(agora))
    const vistos: string[] = []
    let antes: string | null = null
    for (let i = 0; i < 10; i++) {
      const p: Awaited<ReturnType<typeof listNotifications>> = await listNotifications(ctx, { antes, limite: 5 })
      vistos.push(...p.itens.map((x) => x.id))
      if (!p.proximo) break
      assert.ok(parseCursor(p.proximo))
      antes = p.proximo
    }
    assert.equal(new Set(vistos).size, vistos.length)
    assert.equal(vistos.length, (await db.notification.count({ where: { userId: ctx.userId, apagadaEm: null } })))
    assert.ok(vistos.length >= r.itens.length)
    assert.equal(parseCursor('lixo; DROP TABLE'), null)
  })

  it('vence aos 7 dias: some da lista e a limpeza apaga de verdade', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    const novo = (dias: number, k: string) => db.notification.create({ data: { userId: ctx.userId, workspaceId: ws, tipo: 'followup', titulo: k, dedupeKey: `t:${k}`, ocorridoEm: new Date(agora - dias * 86_400_000), createdAt: new Date(agora - dias * 86_400_000) } })
    await novo(8, 'velha')
    await novo(6, 'recente')
    const l = await listNotifications(ctx, { now: new Date(agora) })
    assert.deepEqual(l.itens.map((i) => i.titulo), ['recente'])
    assert.equal(l.naoLidas, 1)
    const apagadas = await purgeExpired(new Date(agora), true)
    assert.ok(apagadas >= 1)
    assert.equal(await db.notification.count({ where: { userId: ctx.userId, titulo: 'velha' } }), 0)
    assert.equal(await db.notification.count({ where: { userId: ctx.userId, titulo: 'recente' } }), 1)
  })
})

describe('custo da sincronização', () => {
  it('sem novidade custa poucas consultas; com novidade só consulta as fontes que mudaram', async () => {
    const w = await makeWorld()
    const base = Date.now()
    const ws = w.w1.id
    const ctx = w.ctx(w.owner, ws)
    await db.whatsAppSession.create({ data: { workspaceId: ws, status: 'CONECTADO', connectedAt: ago(500, base) } })
    await sync(ctx, new Date(base - 5 * 60_000)) // primeira (aprende o estado do WhatsApp)
    await purgeExpired(new Date(base), true) // a limpeza preguiçosa tem o seu próprio intervalo; fora da conta

    const semNovidade = await contar(() => sync(ctx, new Date(base)))
    console.log(`[custo] sync sem novidade: ${semNovidade.dados} consultas (${semNovidade.n} contando BEGIN/COMMIT/SELECT 1 do Prisma)`)
    for (const s of semNovidade.sql) console.log('   -', s.replace(/\s+/g, ' ').slice(0, 110))
    assert.ok(semNovidade.dados <= 4, `sem novidade deveria custar até 4 consultas, custou ${semNovidade.dados}`)

    // Só a agenda mudou
    const c = await contato(ws, 'Rafael Costa')
    await seedEvent(ws, c.id, { origem: 'IA', criadoMin: -0.5 }, base)
    const soAgenda = await contar(() => sync(ctx, new Date(base + 60_000)))
    console.log(`[custo] sync só com agenda: ${soAgenda.dados} consultas (${soAgenda.n} no total)`)
    assert.ok(soAgenda.dados <= 10, `só agenda deveria custar até 10, custou ${soAgenda.dados}`)
    assert.equal(soAgenda.valor.itens.length, 1)

    // Dentro do intervalo mínimo (duas abas quase juntas): sem varredura
    const logo = await contar(() => sync(ctx, new Date(base + 62_000)))
    console.log(`[custo] sync 2 s depois (sem varredura): ${logo.dados} consultas`)
    assert.ok(logo.dados <= 3)

    // Rajada de novidades de todos os tipos (dono): quantas consultas no pior caso
    const w2 = await makeWorld()
    const agora = Date.now()
    await semearTudo(w2, agora)
    const cheio = await contar(() => sync(w2.ctx(w2.owner, w2.w1.id), new Date(agora)))
    console.log(`[custo] primeira sync com todos os tipos (dono): ${cheio.dados} consultas (${cheio.n} no total)`)
    assert.ok(cheio.dados <= 40)
  })
})

describe('textos e utilitários', () => {
  it('nomes: "Teresa, Pao e mais 1"', () => {
    assert.equal(nomesResumo(['Teresa'], 1), 'Teresa')
    assert.equal(nomesResumo(['Teresa', 'Pao'], 2), 'Teresa e Pao')
    assert.equal(nomesResumo(['Teresa', 'Pao', 'Lu'], 3), 'Teresa, Pao e Lu')
    assert.equal(nomesResumo(['Teresa', 'Pao', 'Lu'], 5), 'Teresa, Pao e mais 3')
  })

  it('dia relativo em São Paulo: hoje, amanhã, ontem e dia da semana', () => {
    const agora = new Date('2026-10-05T15:00:00Z').getTime() // segunda, 12:00 em São Paulo
    assert.equal(quandoAgenda('2026-10-05T17:00:00Z', agora), 'hoje, 14:00')
    assert.equal(quandoAgenda('2026-10-06T19:00:00Z', agora), 'amanhã, 16:00')
    assert.equal(quandoAgenda('2026-10-04T13:30:00Z', agora), 'ontem, 10:30')
    assert.equal(quandoAgenda('2026-10-09T19:00:00Z', agora), 'sexta, 09/10 às 16:00')
    // 01:30 UTC do dia 6 ainda é noite do dia 5 em São Paulo
    assert.equal(quandoAgenda('2026-10-06T01:30:00Z', agora), 'hoje, 22:30')
  })

  it('resumo "enquanto você esteve fora"', () => {
    assert.equal(resumoAusente({ ia_respondeu: 3, agenda_novo: 1 }), 'A IA respondeu 3 conversas e há 1 agendamento novo')
    assert.equal(resumoAusente({ passou_para_voce: 1 }), 'A IA passou 1 conversa para a equipe')
    assert.equal(resumoAusente({}), null)
    assert.equal(resumoAusente({ ia_respondeu: 2, passou_para_voce: 1, agenda_novo: 2, followup: 4 }), 'A IA passou 1 conversa para a equipe, a IA respondeu 2 conversas e mais 6 novidades')
  })

  it('limite de taxa por usuário: estoura e depois libera', () => {
    const u = `u-${uniq()}`
    const t0 = 1_000_000
    for (let i = 0; i < 20; i++) assert.equal(limitar(u, 'sync', t0 + i), 0)
    assert.ok(limitar(u, 'sync', t0 + 21) > 0)
    assert.equal(limitar(u, 'sync', t0 + 61_000), 0)
    assert.equal(limitar(`outro-${u}`, 'sync', t0 + 21), 0) // outro usuário não é afetado
  })
})
