// Fontes do sininho: LEEM o que já está gravado (jobs da IA, conversas, agenda, campanhas...) numa janela de tempo e devolvem
// "fatos". Não há gancho no motor: nada aqui escreve em tabelas de outros módulos. Nunca lê texto de mensagens.
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { papelCan } from '@/server/auth/permissions'
import type { Papel } from '@/server/auth/permissions'
import { HANDOFF_BILLING_NOTE, HANDOFF_LIMIT_NOTE, HANDOFF_MODEL_NOTE, HANDOFF_RULE_PREFIX } from '@/server/engine/handoff-reasons'
import { getAiQuota } from '@/server/settings/service'
import { spMonthKey } from '@/server/calendar/time'
import { getWorkspaceTz } from '@/server/workspace-locale'
import { AGENDA_TITULO, diaDoAgendamento, quandoAgenda } from './format'
import { AGENDA_MAX_INDIVIDUAIS } from './types'
import type { NotifDados, NotifTipo } from './types'

export type Contexto = { userId: string; workspaceId: string; organizationId: string | null; papel: Papel; email?: string | null }
export type Janela = { since: Date; upTo: Date }

/** Tipos que somam itens (uma linha por tipo e sincronização). */
export type AggTipo = Extract<NotifTipo, 'ia_respondeu' | 'passou_para_voce' | 'esperando_resposta' | 'nova_conversa' | 'followup' | 'falha_envio' | 'agenda_novo' | 'agenda_remarcado' | 'agenda_cancelado' | 'agenda_confirmado' | 'agenda_remarcar'>
export type AggFato = { tipo: AggTipo; id: string; nome?: string; motivo?: string; at: Date }
export type UnicoFato = { tipo: NotifTipo; key: string; at: Date; titulo: string; corpo: string | null; link: string | null; dados?: NotifDados }
export type Estado = { wa?: 'on' | 'off' | 'drop'; cota?: string }
export type Coletado = { agg: AggFato[]; unicos: UnicoFato[]; estado: Estado }

/** Follow-up só olha jobs com horário previsto nas últimas 6 h antes da janela (o job sai pouco depois de vencer). */
const FOLLOWUP_FOLGA_MS = 6 * 3_600_000
/** Agendamentos muito antigos não entram (confirmação/cancelamento valem para o que ainda está perto). */
const EVENTO_FOLGA_MS = 24 * 3_600_000
/** Job "executando" há mais que isso está preso: não segura a janela. */
const EXECUTANDO_MAX_MS = 3 * 60_000

const ID_OK = /^[A-Za-z0-9_-]{1,64}$/
export const linkConversa = (id: string): string => (ID_OK.test(id) ? `/whatsapp?c=${id}` : '/whatsapp')
const LINK_FILTRO_IA = '/whatsapp?filtro=com_ia'
const LINK_FILTRO_NAO_LIDAS = '/whatsapp?filtro=nao_lidas'

/** Nome do contato para exibir (só o nome, sem telefone nem texto de mensagem). */
export function nomeContato(nome: string | null | undefined): string {
  const n = (nome ?? '').trim().replace(/\s+/g, ' ')
  if (!n) return 'Contato'
  return n.length > 40 ? `${n.slice(0, 39)}…` : n
}

const curto = (s: string | null | undefined, max = 80): string | undefined => {
  const t = (s ?? '').trim().replace(/\s+/g, ' ')
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : undefined
}

// ---------------------------------------------------------------------------------------------------------------------
// Sondagem: UMA consulta diz quais fontes têm novidade na janela (e se há resposta da IA ainda em andamento).
// Os predicados são os mesmos das fontes abaixo: se mudar um, mude o outro.
// ---------------------------------------------------------------------------------------------------------------------

export type Sondagem = { conv: boolean; ia: boolean; fu: boolean; ev: boolean; wa: boolean; camp: boolean; inv: boolean; seguraAte: Date | null }

export async function sondar(ctx: Contexto, j: Janela): Promise<Sondagem> {
  const { workspaceId: ws, organizationId: org } = ctx
  const { since: a, upTo: b } = j
  const manager = papelCan(ctx.papel, 'campaigns.manage')
  const team = papelCan(ctx.papel, 'team.manage')
  const fuFloor = new Date(a.getTime() - FOLLOWUP_FOLGA_MS)
  const evFloor = new Date(a.getTime() - EVENTO_FOLGA_MS)
  const holdFloor = new Date(b.getTime() - EXECUTANDO_MAX_MS)
  const camp = manager
    ? Prisma.sql`EXISTS (SELECT 1 FROM "Campaign" k WHERE k."workspaceId" = ${ws} AND k."status" = 'concluida' AND k."updatedAt" > ${a} AND k."updatedAt" <= ${b})`
    : Prisma.sql`false`
  const inv =
    team && org
      ? Prisma.sql`EXISTS (SELECT 1 FROM "Invite" i WHERE i."organizationId" = ${org} AND i."aceitoEm" > ${a} AND i."aceitoEm" <= ${b})`
      : Prisma.sql`false`
  const rows = await db.$queryRaw<{ conv: boolean; ia: boolean; fu: boolean; ev: boolean; wa: boolean; camp: boolean; inv: boolean; segura: Date | null }[]>(Prisma.sql`
    SELECT
      EXISTS (SELECT 1 FROM "Conversation" c WHERE c."workspaceId" = ${ws} AND c."lastMessageAt" > ${a} AND c."lastMessageAt" <= ${b}) AS conv,
      EXISTS (SELECT 1 FROM "AiJob" j WHERE j."status" IN ('feito', 'erro') AND j."runAt" > ${a} AND j."runAt" <= ${b} AND j."workspaceId" = ${ws}) AS ia,
      EXISTS (SELECT 1 FROM "FollowUpJob" f JOIN "Conversation" c ON c."id" = f."conversationId"
              WHERE f."status" IN ('enviado', 'erro') AND f."runAt" >= ${fuFloor} AND f."updatedAt" > ${a} AND f."updatedAt" <= ${b} AND c."workspaceId" = ${ws}) AS fu,
      EXISTS (SELECT 1 FROM "Event" e WHERE e."workspaceId" = ${ws} AND e."inicio" >= ${evFloor}
              AND ((e."createdAt" > ${a} AND e."createdAt" <= ${b}) OR (e."canceladoEm" > ${a} AND e."canceladoEm" <= ${b})
                OR (e."confirmadoEm" > ${a} AND e."confirmadoEm" <= ${b}) OR (e."updatedAt" > ${a} AND e."updatedAt" <= ${b}))) AS ev,
      EXISTS (SELECT 1 FROM "WhatsAppSession" s WHERE s."workspaceId" = ${ws} AND s."updatedAt" > ${a} AND s."updatedAt" <= ${b}) AS wa,
      ${camp} AS camp,
      ${inv} AS inv,
      (SELECT MIN(x."runAt") FROM "AiJob" x WHERE x."status" = 'executando' AND x."workspaceId" = ${ws} AND x."runAt" > ${holdFloor}) AS segura`)
  const r = rows[0]
  return {
    conv: !!r?.conv,
    ia: !!r?.ia,
    fu: !!r?.fu,
    ev: !!r?.ev,
    wa: !!r?.wa,
    camp: !!r?.camp,
    inv: !!r?.inv,
    seguraAte: r?.segura ?? null,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------------------------------------------------

type ConvInfo = { id: string; contactId: string; nome: string }

/** Nomes das conversas citadas (uma consulta só). Conversa de outro espaço nunca entra: o filtro é pelo espaço. */
async function carregarConversas(workspaceId: string, ids: string[]): Promise<Map<string, ConvInfo>> {
  const out = new Map<string, ConvInfo>()
  if (ids.length === 0) return out
  const rows = await db.conversation.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true, contactId: true, contact: { select: { nome: true } } },
  })
  for (const r of rows) out.set(r.id, { id: r.id, contactId: r.contactId, nome: nomeContato(r.contact.nome) })
  return out
}

function motivoDaPassagem(error: string): string | null {
  if (error.startsWith(HANDOFF_RULE_PREFIX)) return curto(error.slice(HANDOFF_RULE_PREFIX.length)) ?? 'regra de passagem'
  if (error === HANDOFF_MODEL_NOTE) return 'decisão da IA'
  // Passagem forçada pelo acabamento da resposta (src/server/agent/finish.ts, NOTE_PROMESSA): "passagem pelo modelo (…)".
  if (error.startsWith(`${HANDOFF_MODEL_NOTE} (`)) return 'a IA prometeu uma ação da equipe'
  if (error.startsWith(HANDOFF_LIMIT_NOTE)) return 'limite de respostas de IA do plano'
  if (error === HANDOFF_BILLING_NOTE) return 'assinatura inativa'
  return null
}

type FerramentaLog = { nome?: unknown; ok?: unknown }
const remarcouNoJob = (f: unknown): boolean =>
  Array.isArray(f) && (f as FerramentaLog[]).some((x) => x && x.nome === 'remarcar_agendamento' && x.ok === true)

export async function coletar(ctx: Contexto, j: Janela, s: Sondagem, estadoAtual: Estado): Promise<Coletado> {
  const { workspaceId, userId } = ctx
  const { since, upTo } = j
  const agg: AggFato[] = []
  const unicos: UnicoFato[] = []
  const estado: Estado = { ...estadoAtual }

  // ---- Respostas da IA, passagens e falhas (AiJob terminado na janela: runAt = momento em que o job começou) ----
  const jobsCitados: { id: string; conversationId: string; at: Date; tipo: 'ia_respondeu' | 'passou_para_voce' | 'falha_envio'; motivo?: string }[] = []
  const remarcouConv = new Set<string>()
  if (s.ia) {
    const jobs = await db.aiJob.findMany({
      where: { workspaceId, status: { in: ['feito', 'erro'] }, runAt: { gt: since, lte: upTo } },
      select: { id: true, conversationId: true, status: true, error: true, ferramentas: true, runAt: true },
      orderBy: { runAt: 'desc' },
      take: 1000,
    })
    for (const job of jobs) {
      if (job.status === 'erro') {
        jobsCitados.push({ id: job.id, conversationId: job.conversationId, at: job.runAt, tipo: 'falha_envio', motivo: curto(job.error) ?? 'erro ao responder' })
        continue
      }
      if (remarcouNoJob(job.ferramentas)) remarcouConv.add(job.conversationId)
      if (!job.error) {
        jobsCitados.push({ id: job.id, conversationId: job.conversationId, at: job.runAt, tipo: 'ia_respondeu' })
        continue
      }
      const motivo = motivoDaPassagem(job.error)
      if (motivo) jobsCitados.push({ id: job.id, conversationId: job.conversationId, at: job.runAt, tipo: 'passou_para_voce', motivo })
    }
  }

  // ---- Follow-up enviado / falhou (updatedAt = momento em que o job terminou) ----
  const fuCitados: { id: string; conversationId: string; at: Date; erro?: string }[] = []
  if (s.fu) {
    const fus = await db.followUpJob.findMany({
      where: {
        status: { in: ['enviado', 'erro'] },
        runAt: { gte: new Date(since.getTime() - FOLLOWUP_FOLGA_MS), lte: upTo },
        updatedAt: { gt: since, lte: upTo },
        conversation: { workspaceId },
      },
      select: { id: true, conversationId: true, status: true, error: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    })
    for (const f of fus) fuCitados.push({ id: f.id, conversationId: f.conversationId, at: f.updatedAt, erro: f.status === 'erro' ? (curto(f.error) ?? 'erro no follow-up') : undefined })
  }

  // ---- Conversas com mensagem nova na janela: novas conversas e conversas esperando a equipe ----
  type ConvRow = { id: string; mode: 'IA' | 'HUMANO' | null; unread: number; assigneeId: string | null; createdAt: Date; lastMessageAt: Date | null; contactId: string; contact: { nome: string } }
  let convRows: ConvRow[] = []
  const comMensagemDoCliente = new Set<string>()
  if (s.conv) {
    convRows = await db.conversation.findMany({
      where: { workspaceId, lastMessageAt: { gt: since, lte: upTo } },
      select: { id: true, mode: true, unread: true, assigneeId: true, createdAt: true, lastMessageAt: true, contactId: true, contact: { select: { nome: true } } },
      orderBy: { lastMessageAt: 'desc' },
      take: 500,
    })
    if (convRows.length > 0) {
      // Só conta quem recebeu mensagem REAL do cliente na janela (histórico importado não gera aviso).
      const inb = await db.message.findMany({
        where: { conversationId: { in: convRows.map((c) => c.id) }, direction: 'IN', imported: false, createdAt: { gt: since, lte: upTo } },
        select: { conversationId: true },
        distinct: ['conversationId'],
      })
      for (const m of inb) comMensagemDoCliente.add(m.conversationId)
    }
  }

  // Nomes e contatos das conversas citadas pelos jobs (as de `convRows` já trazem o nome).
  const precisam = Array.from(new Set([...jobsCitados.map((x) => x.conversationId), ...fuCitados.map((x) => x.conversationId)]))
  const infos = await carregarConversas(workspaceId, precisam)
  for (const c of convRows) infos.set(c.id, { id: c.id, contactId: c.contactId, nome: nomeContato(c.contact.nome) })

  const passou = new Set<string>()
  for (const x of jobsCitados) {
    const info = infos.get(x.conversationId)
    if (!info) continue // conversa apagada ou de outro espaço
    if (x.tipo === 'falha_envio') agg.push({ tipo: 'falha_envio', id: x.id, motivo: x.motivo, at: x.at })
    else {
      agg.push({ tipo: x.tipo, id: x.conversationId, nome: info.nome, motivo: x.motivo, at: x.at })
      if (x.tipo === 'passou_para_voce') passou.add(x.conversationId)
    }
  }
  for (const x of fuCitados) {
    if (x.erro) {
      agg.push({ tipo: 'falha_envio', id: `fu:${x.id}`, motivo: x.erro, at: x.at })
      continue
    }
    const info = infos.get(x.conversationId)
    if (info) agg.push({ tipo: 'followup', id: x.conversationId, nome: info.nome, at: x.at })
  }

  if (convRows.length > 0) {
    // Esperando: sem IA para responder (modo humano ou ninguém atendeu), mensagem do cliente sem resposta e não é de outra pessoa.
    const candidatas = convRows.filter(
      (c) => comMensagemDoCliente.has(c.id) && c.mode !== 'IA' && c.unread > 0 && (c.assigneeId === null || c.assigneeId === userId) && !passou.has(c.id),
    )
    const emAndamento = new Set<string>()
    if (candidatas.length > 0) {
      // A IA ainda vai responder (job na fila ou rodando): não está "esperando a equipe".
      const pend = await db.aiJob.findMany({
        where: { conversationId: { in: candidatas.map((c) => c.id) }, status: { in: ['pendente', 'executando'] } },
        select: { conversationId: true },
        distinct: ['conversationId'],
      })
      for (const p of pend) emAndamento.add(p.conversationId)
    }
    const esperando = new Set<string>()
    for (const c of candidatas) {
      if (emAndamento.has(c.id)) continue
      esperando.add(c.id)
      agg.push({ tipo: 'esperando_resposta', id: c.id, nome: nomeContato(c.contact.nome), at: c.lastMessageAt ?? upTo })
    }
    for (const c of convRows) {
      if (!comMensagemDoCliente.has(c.id) || esperando.has(c.id) || passou.has(c.id)) continue
      if (c.createdAt > since && c.createdAt <= upTo) agg.push({ tipo: 'nova_conversa', id: c.id, nome: nomeContato(c.contact.nome), at: c.createdAt })
    }
  }

  // ---- Agenda: cada agendamento vira um item próprio (até o limite); o excedente vira uma linha "N agendamentos ..." ----
  if (s.ev) await coletarAgenda(ctx, j, infos, remarcouConv, agg, unicos)

  // ---- Falhas já viraram agg; cota de IA só olha quando a IA respondeu e a pessoa administra a conta ----
  if (papelCan(ctx.papel, 'agent.manage') && agg.some((a) => a.tipo === 'ia_respondeu')) await coletarCota(ctx, upTo, estado, unicos)

  // ---- Só dono/administrador: campanhas concluídas e convites aceitos ----
  if (s.camp && papelCan(ctx.papel, 'campaigns.manage')) await coletarCampanhas(ctx, j, unicos)
  if (s.inv && papelCan(ctx.papel, 'team.manage') && ctx.organizationId) await coletarConvites(ctx, j, unicos)

  // ---- WhatsApp: queda e volta (transição de estado; a queda só conta se o número já esteve conectado) ----
  if (s.wa || estado.wa === undefined) await coletarWhatsApp(ctx, j, estado, unicos)

  return { agg, unicos, estado }
}

async function coletarAgenda(ctx: Contexto, j: Janela, infos: Map<string, ConvInfo>, remarcouConv: Set<string>, agg: AggFato[], unicos: UnicoFato[]): Promise<void> {
  const { workspaceId } = ctx
  const { since, upTo } = j
  const noW = (d: Date | null): d is Date => !!d && d > since && d <= upTo
  const contatosRemarcou = new Set<string>()
  for (const id of Array.from(remarcouConv)) {
    const i = infos.get(id)
    if (i) contatosRemarcou.add(i.contactId)
  }
  const janela = { gt: since, lte: upTo }
  // "Hoje/amanhã" e o dia do link da Agenda no relógio do espaço.
  const tz = await getWorkspaceTz(workspaceId)
  const rows = await db.event.findMany({
    where: {
      workspaceId,
      inicio: { gte: new Date(since.getTime() - EVENTO_FOLGA_MS) },
      OR: [
        { createdAt: janela },
        { canceladoEm: janela },
        { confirmadoEm: janela },
        { updatedAt: janela },
      ],
    },
    select: {
      id: true,
      inicio: true,
      origem: true,
      canal: true,
      status: true,
      canceladoEm: true,
      canceladoPor: true,
      confirmacao: true,
      confirmadoEm: true,
      createdAt: true,
      updatedAt: true,
      contactId: true,
      contact: { select: { nome: true } },
    },
    orderBy: { updatedAt: 'asc' },
    take: 500,
  })

  type Item = { tipo: Extract<AggTipo, `agenda_${string}`>; at: Date; id: string; cliente: string; inicio: Date; origem?: 'ia' | 'link' }
  const itens: Item[] = []
  for (const e of rows) {
    const cliente = nomeContato(e.contact?.nome)
    // O que acontece fora da tela do dono: IA e link público criam; a equipe cria na própria tela (o servidor não sabe QUEM,
    // então esses não geram aviso, para nunca avisar a pessoa do que ela mesma fez).
    if (noW(e.createdAt) && (e.origem === 'IA' || e.canal === 'link')) {
      itens.push({ tipo: 'agenda_novo', at: e.createdAt, id: e.id, cliente, inicio: e.inicio, origem: e.canal === 'link' ? 'link' : 'ia' })
    }
    if (e.status === 'cancelado' && e.canceladoPor === 'cliente' && noW(e.canceladoEm)) {
      itens.push({ tipo: 'agenda_cancelado', at: e.canceladoEm, id: e.id, cliente, inicio: e.inicio })
    }
    if (e.status === 'ativo' && e.confirmacao === 'confirmado' && noW(e.confirmadoEm)) {
      itens.push({ tipo: 'agenda_confirmado', at: e.confirmadoEm, id: e.id, cliente, inicio: e.inicio })
    }
    if (e.status === 'ativo' && e.confirmacao === 'recusado' && noW(e.updatedAt)) {
      itens.push({ tipo: 'agenda_remarcar', at: e.updatedAt, id: e.id, cliente, inicio: e.inicio })
    }
    // Remarcado pela IA: o job dela registrou a ferramenta de remarcar e o agendamento do contato mudou na janela.
    if (e.status === 'ativo' && e.confirmacao === 'pendente' && !noW(e.createdAt) && noW(e.updatedAt) && e.contactId && contatosRemarcou.has(e.contactId)) {
      itens.push({ tipo: 'agenda_remarcado', at: e.updatedAt, id: e.id, cliente, inicio: e.inicio, origem: 'ia' })
    }
  }

  const porTipo = new Map<string, Item[]>()
  for (const it of itens) porTipo.set(it.tipo, [...(porTipo.get(it.tipo) ?? []), it])
  for (const [tipo, lista] of Array.from(porTipo.entries())) {
    lista.sort((a, b) => a.at.getTime() - b.at.getTime())
    for (const it of lista.slice(0, AGENDA_MAX_INDIVIDUAIS)) {
      const iso = it.inicio.toISOString()
      unicos.push({
        tipo: it.tipo,
        key: `ag:${it.tipo}:${it.id}:${it.at.getTime()}`,
        at: it.at,
        titulo: AGENDA_TITULO[it.tipo],
        corpo: `${it.cliente} · ${quandoAgenda(iso, it.at.getTime(), tz)}`,
        link: `/agenda?dia=${diaDoAgendamento(iso, tz)}`,
        dados: { cliente: it.cliente, inicio: iso, ...(it.origem ? { origem: it.origem } : {}) },
      })
    }
    for (const it of lista.slice(AGENDA_MAX_INDIVIDUAIS)) agg.push({ tipo: tipo as AggTipo, id: it.id, nome: it.cliente, at: it.at })
  }
}

async function coletarCota(ctx: Contexto, upTo: Date, estado: Estado, unicos: UnicoFato[]): Promise<void> {
  const q = await getAiQuota(ctx.workspaceId)
  if (q.limite === null || q.limite <= 0) return
  const mes = spMonthKey(upTo)
  const nivel = q.usadas >= q.limite ? 100 : q.usadas / q.limite >= 0.8 ? 80 : 0
  if (nivel === 0) return
  const [mesVisto, nivelVisto] = (estado.cota ?? '').split(':')
  if (mesVisto === mes && Number(nivelVisto) >= nivel) return // esse aviso (ou um pior) já foi dado neste mês
  estado.cota = `${mes}:${nivel}`
  unicos.push({
    tipo: 'cota_ia',
    key: `cota:${mes}:${nivel}`,
    at: upTo,
    titulo: nivel >= 100 ? 'Cota de IA esgotada' : 'Cota de IA perto do limite',
    corpo: nivel >= 100 ? `As ${q.limite} respostas de IA do mês acabaram. As conversas passam para a equipe.` : `${q.usadas} de ${q.limite} respostas de IA do mês já foram usadas.`,
    link: null,
    dados: { nivel },
  })
}

async function coletarCampanhas(ctx: Contexto, j: Janela, unicos: UnicoFato[]): Promise<void> {
  const camps = await db.campaign.findMany({
    where: { workspaceId: ctx.workspaceId, status: 'concluida', updatedAt: { gt: j.since, lte: j.upTo } },
    select: { id: true, lista: true, total: true, enviadas: true, updatedAt: true },
    take: 50,
  })
  if (camps.length === 0) return
  const falhas = await db.campaignRecipient.groupBy({ by: ['campaignId'], where: { campaignId: { in: camps.map((c) => c.id) }, status: 'erro' }, _count: { _all: true } })
  const falhasPor = new Map(falhas.map((f) => [f.campaignId, f._count._all]))
  for (const c of camps) {
    const n = falhasPor.get(c.id) ?? 0
    unicos.push({
      tipo: 'campanha',
      key: `camp:${c.id}`, // um aviso por campanha: se ela for mexida de novo depois, não repete
      at: c.updatedAt,
      titulo: 'Campanha concluída',
      corpo: `${curto(c.lista, 40) ?? 'Disparo'} · ${c.enviadas} ${c.enviadas === 1 ? 'enviada' : 'enviadas'}${n > 0 ? `, ${n} ${n === 1 ? 'falha' : 'falhas'}` : ''}`,
      link: null,
      dados: { enviadas: c.enviadas, falhas: n },
    })
  }
}

async function coletarConvites(ctx: Contexto, j: Janela, unicos: UnicoFato[]): Promise<void> {
  const { organizationId, workspaceId } = ctx
  if (!organizationId) return
  const invs = await db.invite.findMany({
    where: {
      organizationId,
      aceitoEm: { gt: j.since, lte: j.upTo },
      OR: [{ papel: { in: ['owner', 'admin'] } }, { workspaceIds: { has: workspaceId } }],
    },
    select: { id: true, email: true, papel: true, aceitoEm: true },
    take: 50,
  })
  if (invs.length === 0) return
  const meu = (ctx.email ?? '').toLowerCase()
  const emails = invs.map((i) => i.email.toLowerCase()).filter((e) => e !== meu) // quem aceitou é a própria pessoa: sem aviso
  if (emails.length === 0) return
  const users = await db.user.findMany({ where: { email: { in: emails }, organizationId }, select: { email: true, nome: true } })
  const nomePor = new Map(users.map((u) => [u.email.toLowerCase(), u.nome]))
  const ROTULO: Record<string, string> = { owner: 'Dono', admin: 'Administrador', agent: 'Atendente' }
  for (const i of invs) {
    const em = i.email.toLowerCase()
    if (em === meu || !i.aceitoEm) continue
    unicos.push({
      tipo: 'equipe_convite',
      key: `inv:${i.id}`,
      at: i.aceitoEm,
      titulo: `${nomeContato(nomePor.get(em) ?? 'Alguém')} entrou na equipe`,
      corpo: ROTULO[i.papel] ?? null,
      link: null,
    })
  }
}

async function coletarWhatsApp(ctx: Contexto, j: Janela, estado: Estado, unicos: UnicoFato[]): Promise<void> {
  const s = await db.whatsAppSession.findUnique({ where: { workspaceId: ctx.workspaceId }, select: { status: true, connectedAt: true, updatedAt: true } })
  if (!s) {
    estado.wa = 'off' // espaço sem registro de conexão = nunca conectou
    return
  }
  const on = s.status === 'CONECTADO'
  const prev = estado.wa
  const noW = s.updatedAt > j.since && s.updatedAt <= j.upTo
  if (prev === undefined) {
    estado.wa = on ? 'on' : 'off' // primeiro olhar: só aprende o estado, sem avisar
    return
  }
  if (!noW) return
  if (prev === 'on' && !on) {
    // Desconexão feita pela pessoa limpa `connectedAt`; queda do aparelho/da rede mantém. Só a queda avisa.
    if (s.connectedAt) {
      estado.wa = 'drop'
      unicos.push({
        tipo: 'whatsapp_desconectou',
        key: `wa:off:${s.updatedAt.getTime()}`,
        at: s.updatedAt,
        titulo: 'WhatsApp desconectado',
        corpo: 'A IA, o follow-up e os disparos foram pausados. Reconecte para voltar a atender.',
        link: '/whatsapp',
      })
    } else {
      estado.wa = 'off'
    }
  } else if (prev === 'drop' && on) {
    estado.wa = 'on'
    unicos.push({
      tipo: 'whatsapp_reconectou',
      key: `wa:on:${s.updatedAt.getTime()}`,
      at: s.updatedAt,
      titulo: 'WhatsApp reconectado',
      corpo: 'As automações continuam desligadas até você ligar de novo.',
      link: '/whatsapp',
    })
  } else if (on && prev !== 'on') {
    estado.wa = 'on'
  } else if (!on && prev === 'on') {
    estado.wa = 'off'
  }
}

export { LINK_FILTRO_IA, LINK_FILTRO_NAO_LIDAS }
