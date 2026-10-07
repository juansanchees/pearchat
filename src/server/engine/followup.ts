import { db } from '@/lib/db'
import { automationAllowed } from '@/server/billing/entitlements'
import { FU_MENSAGENS_PADRAO } from '@/server/followup/service'
import { canSendFreeformTo } from './freeform'
import { contactRef, OutboundAlreadySentError, OutboundCancelledError, OutboundError, sendAndRecord } from './outbound'
import type { OutboundContent } from './outbound'
import { nextHourTz, normTz, tzParts } from '@/lib/timezone'
import { getConnected, log, logError, personalize, shortError, templateFirstName } from './util'

// Follow-up automático. Planejamento (cria FollowUpJob) + execução (envia) + cancelamento (ingest).
//
// Regras de tempo:
//  - o relógio de cada tentativa é a ÚLTIMA mensagem nossa da conversa (inclusive resposta manual de uma
//    pessoa): se alguém responde à mão depois de o job ser planejado, o job é reagendado para
//    "essa mensagem + esperaHoras" (a tentativa continua a mesma);
//  - não envia entre 21h e 8h (relógio do espaço, Workspace.timezone): reagenda para as 8h;
//  - no máximo UM envio por workspace a cada tick (5 s): depois de religar o follow-up ou reconectar o
//    WhatsApp, os jobs atrasados saem em fila, nunca numa rajada.
//
// Pendência: a condição de parada "Pedido fechado" não tem sinal no modelo de dados (não há pedido
// ligado à conversa). Quando existir (ex.: Contact.pedidos incrementado), basta cancelar aqui.

const STATUS = { pendente: 'pendente', executando: 'executando', enviado: 'enviado', erro: 'erro', cancelado: 'cancelado' } as const
const QUIET_START = 21 // não envia entre 21h e 8h (fuso do espaço)
const QUIET_END = 8
const LOOKBACK_MS = 7 * 24 * 3_600_000 // não retoma conversas paradas há mais de 7 dias
const STALE_MS = 3 * 60_000
const PAGE = 200 // conversas candidatas lidas por página
const MAX_PAGES = 50
const MAX_SENDS_PER_WORKSPACE_PER_TICK = 1
export const FOLLOWUP_TEMPLATE = 'retomada_conversa'

/** `d` cai entre 21h e 8h no relógio do espaço (`tz`)? */
export const inQuietHours = (d: Date, tz: string): boolean => {
  // Só para testes em modo demo: ignora a janela de 21h às 8h.
  if (process.env.WA_MOCK === 'true' && process.env.ENGINE_FOLLOWUP_ANYTIME === 'true') return false
  const h = tzParts(d, tz).hour
  return h >= QUIET_START || h < QUIET_END
}

/** Se `d` cai entre 21h e 8h (relógio do espaço), devolve as 8h seguintes desse relógio. */
export const adjustToSendWindow = (d: Date, tz: string): Date => (inQuietHours(d, tz) ? nextHourTz(d, QUIET_END, tz) : d)

/** Cancela os follow-ups pendentes da conversa (ex.: "Cliente respondeu"). */
export async function cancelPendingFollowUps(conversationId: string, motivo: string): Promise<number> {
  const r = await db.followUpJob.updateMany({
    where: { conversationId, status: { in: [STATUS.pendente, STATUS.executando] } },
    data: { status: STATUS.cancelado, error: motivo },
  })
  return r.count
}

/**
 * Cria o job só se a conversa não tem outro aberto. O lock consultivo por conversa serializa dois
 * planejadores simultâneos (duas instâncias, ou o tick de desenvolvimento junto do agendador).
 */
async function createJobOnce(conversationId: string, tentativa: number, runAt: Date, now: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followup:' + conversationId}))`
    const open = await tx.followUpJob.count({ where: { conversationId, status: { in: [STATUS.pendente, STATUS.executando] } } })
    if (open > 0) return false
    await tx.followUpJob.create({ data: { conversationId, tentativa, runAt, status: STATUS.pendente, createdAt: now } })
    return true
  })
}

/**
 * Mantém os jobs pendentes coerentes com a conversa (a fila mostra o horário certo):
 *  - o cliente falou depois do planejamento (ou pediu para parar): cancela;
 *  - a conversa está em HUMANO (uma pessoa assumiu, ou a IA passou a conversa): cancela ("Atendimento assumido").
 *    Resposta manual NÃO reagenda mais: o send.ts já cancela na hora e a automação só volta com "Devolver para IA".
 */
async function replanPendingJobs(): Promise<void> {
  const pending = await db.followUpJob.findMany({
    where: { status: STATUS.pendente },
    take: 500,
    select: {
      id: true,
      runAt: true,
      createdAt: true,
      conversation: {
        select: {
          workspaceId: true,
          mode: true,
          contact: { select: { optOut: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { direction: true, createdAt: true } },
        },
      },
    },
  })
  if (pending.length === 0) return
  for (const j of pending) {
    const last = j.conversation.messages[0]
    if (!last) continue
    if (j.conversation.contact.optOut) {
      await db.followUpJob.updateMany({ where: { id: j.id, status: STATUS.pendente }, data: { status: STATUS.cancelado, error: 'Cliente pediu para parar' } })
    } else if (last.direction === 'IN') {
      await db.followUpJob.updateMany({ where: { id: j.id, status: STATUS.pendente }, data: { status: STATUS.cancelado, error: 'Cliente respondeu' } })
    } else if (j.conversation.mode === 'HUMANO') {
      await db.followUpJob.updateMany({ where: { id: j.id, status: STATUS.pendente }, data: { status: STATUS.cancelado, error: 'Atendimento assumido' } })
    }
  }
}

/** (a) Cria os jobs devidos. Devolve quantos criou. */
export async function planFollowUps(): Promise<number> {
  const now = new Date()
  await replanPendingJobs()
  const rules = await db.followUpRule.findMany({
    where: { enabled: true, workspace: { arquivadoEm: null, whatsappSession: { is: { status: 'CONECTADO' } } } },
    include: { workspace: { select: { timezone: true } } },
  })
  let created = 0
  for (const rule of rules) {
    // Um workspace com problema não impede o planejamento dos outros.
    try {
      if (!(await automationAllowed(rule.workspaceId))) continue // modo restrito: não planeja follow-up
      created += await planRule({ ...rule, timezone: normTz(rule.workspace.timezone) }, now)
    } catch (e) {
      logError('followup', `planejamento do workspace ${rule.workspaceId} falhou`, e)
    }
  }
  if (created > 0) log('followup', `${created} job(s) criado(s)`)
  return created
}

type Rule = { workspaceId: string; esperaHoras: number; tentativas: number; timezone: string }

async function planRule(rule: Rule, now: Date): Promise<number> {
  let created = 0
  {
    const { workspaceId } = rule
    const cutoff = new Date(now.getTime() - rule.esperaHoras * 3_600_000)
    const lookback = new Date(now.getTime() - LOOKBACK_MS)
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const convs = await db.conversation.findMany({
        where: {
          workspaceId,
          lastMessageAt: { lte: cutoff, gte: lookback },
          // Conversa em HUMANO (pessoa assumiu ou IA passou): sem follow-up em nenhuma tentativa.
          OR: [{ mode: null }, { mode: { not: 'HUMANO' } }],
          contact: { optOut: false, events: { none: { inicio: { gt: now } } } },
          jobs: { none: { status: { in: [STATUS.pendente, STATUS.executando] } } },
          // O cliente já conversou conosco alguma vez (não faz follow-up de disparo frio) e nós falamos depois.
          AND: [{ messages: { some: { direction: 'IN' } } }, { messages: { some: { direction: 'OUT', createdAt: { gte: lookback } } } }],
        },
        orderBy: [{ lastMessageAt: 'asc' }, { id: 'asc' }],
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      for (const c of convs) {
        const last = c.messages[0]
        // Só quando a última mensagem é nossa e já passou a espera (no limite exato, conta).
        if (!last || last.direction !== 'OUT' || last.createdAt > cutoff) continue
        // Histórico importado do WhatsApp: não planeja follow-up sobre conversas anteriores à conexão.
        if (last.imported) continue
        if (last.status === 'FALHOU') continue

        const lastIn = await db.message.findFirst({ where: { conversationId: c.id, direction: 'IN' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
        // Tentativas do ciclo atual: contadas a partir da última mensagem do CLIENTE.
        const doneJobs = await db.followUpJob.findMany({
          where: {
            conversationId: c.id,
            status: { in: [STATUS.enviado, STATUS.erro] },
            ...(lastIn ? { createdAt: { gte: lastIn.createdAt } } : {}),
          },
          orderBy: { runAt: 'desc' },
          select: { runAt: true, status: true },
        })
        if (doneJobs.length >= rule.tentativas) continue
        // Tentativa que falhou sem gerar mensagem: a próxima também espera esperaHoras (não queima as 3 de uma vez).
        const prev = doneJobs[0]
        if (prev && prev.status === STATUS.erro && prev.runAt > cutoff) continue

        if (await createJobOnce(c.id, doneJobs.length + 1, adjustToSendWindow(now, rule.timezone), now)) created++
      }
      if (convs.length < PAGE) break
      cursor = convs[convs.length - 1]?.id
    }
  }
  return created
}

type Job = { id: string; conversationId: string; tentativa: number; timezone: string }
type Outcome = 'enviado' | 'erro' | 'ignorado'

async function finishJob(id: string, status: 'enviado' | 'erro' | 'cancelado', error?: string): Promise<void> {
  await db.followUpJob.update({ where: { id }, data: { status, error: error ?? null } })
}

async function executeJob(job: Job): Promise<Outcome> {
  const skip = async (status: 'cancelado', motivo: string): Promise<Outcome> => {
    await finishJob(job.id, status, motivo)
    return 'ignorado'
  }
  const now = new Date()
  const conv = await db.conversation.findUnique({
    where: { id: job.conversationId },
    include: { contact: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!conv) return skip('cancelado', 'Conversa não existe')
  const { workspaceId } = conv
  const rule = await db.followUpRule.findUnique({ where: { workspaceId } })
  if (!rule?.enabled) {
    // Desligado: o job volta para a fila (a fila mostra "Pausado"); ao religar, sai em ritmo controlado.
    await db.followUpJob.update({ where: { id: job.id }, data: { status: STATUS.pendente } })
    return 'ignorado'
  }
  if (conv.contact.optOut) return skip('cancelado', 'Cliente pediu para parar')
  if (conv.mode === 'HUMANO') return skip('cancelado', 'Atendimento assumido')
  const last = conv.messages[0]
  if (!last || last.direction !== 'OUT') return skip('cancelado', 'Cliente respondeu')
  const session = await getConnected(workspaceId)
  if (!session) {
    // Sem conexão agora: devolve para a fila e tenta mais tarde.
    await db.followUpJob.update({ where: { id: job.id }, data: { status: STATUS.pendente, runAt: new Date(now.getTime() + 5 * 60_000) } })
    return 'ignorado'
  }
  // Alguém (a pessoa do atendimento) respondeu à mão depois do planejamento: o relógio reinicia.
  const wait = rule.esperaHoras * 3_600_000
  if (now.getTime() - last.createdAt.getTime() < wait) {
    const next = adjustToSendWindow(new Date(last.createdAt.getTime() + wait), job.timezone)
    await db.followUpJob.update({ where: { id: job.id }, data: { status: STATUS.pendente, runAt: next } })
    return 'ignorado'
  }

  const ids = { telefone: conv.contact.telefone, waUserId: conv.contact.waUserId }
  const nome = conv.contact.nome
  const padrao = FU_MENSAGENS_PADRAO[job.tentativa - 1] ?? FU_MENSAGENS_PADRAO[0] ?? ''
  let text = personalize(rule.mensagens[job.tentativa - 1]?.trim() || padrao, nome, ids).trim()
  if (!text) text = personalize(padrao, nome, ids).trim()
  const to = contactRef(conv.contact)

  let content: OutboundContent
  let freeform = true
  if (await canSendFreeformTo(session, to)) {
    content = { kind: 'text', text }
  } else {
    freeform = false
    const t = await db.template.findFirst({ where: { workspaceId, name: FOLLOWUP_TEMPLATE } })
    if (!t || t.status !== 'APROVADO') {
      await finishJob(job.id, 'erro', 'Fora da janela de 24h e sem o modelo retomada_conversa aprovado')
      return 'erro'
    }
    const primeiro = templateFirstName(nome, ids)
    content = { kind: 'template', name: t.name, vars: [primeiro], body: t.body.replace(/\{\{1\}\}/g, () => primeiro) }
  }

  try {
    const sent = await sendAndRecord({
      session,
      conversationId: conv.id,
      to,
      author: 'IA',
      content,
      countAtendimento: freeform,
      // Um job de follow-up envia no máximo uma mensagem (retomada após queda não repete).
      sendKey: `fu:${job.id}`,
      // Pessoa assumiu (ou o cliente respondeu) entre a checagem e o envio: não envia.
      guard: async () => {
        const c = await db.conversation.findUnique({ where: { id: conv.id }, select: { mode: true, messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { direction: true } } } })
        if (c?.mode === 'HUMANO') return 'Atendimento assumido'
        if (c?.messages[0]?.direction === 'IN') return 'Cliente respondeu'
        return null
      },
    })
    // Sem confirmação do provedor: conta como enviado (nunca reenvia às cegas; a reconciliação acerta o status).
    await finishJob(job.id, 'enviado', sent.uncertainSince ? 'enviado sem confirmação do WhatsApp' : undefined)
    return 'enviado'
  } catch (e) {
    if (e instanceof OutboundCancelledError) return skip('cancelado', e.message)
    if (e instanceof OutboundAlreadySentError) {
      await finishJob(job.id, 'enviado')
      return 'enviado'
    }
    await finishJob(job.id, 'erro', e instanceof OutboundError ? e.message : shortError(e))
    return 'erro'
  }
}

/**
 * Jobs presos em "executando" (processo caiu no meio): se a mensagem já foi gravada depois da
 * reivindicação, o job é dado como enviado (nunca reenvia); senão volta para a fila.
 */
async function rescueStaleJobs(now: Date): Promise<void> {
  const stale = await db.followUpJob.findMany({
    where: { status: STATUS.executando, updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    select: { id: true, conversationId: true, updatedAt: true },
    take: 100,
  })
  for (const j of stale) {
    const sent = await db.message.findFirst({
      where: {
        conversationId: j.conversationId,
        OR: [
          { sendKey: `fu:${j.id}`, NOT: { status: 'FALHOU' } },
          { direction: 'OUT', author: 'IA', createdAt: { gte: j.updatedAt } },
        ],
      },
      select: { id: true },
    })
    await db.followUpJob.updateMany({
      where: { id: j.id, status: STATUS.executando },
      data: sent ? { status: STATUS.enviado, error: null } : { status: STATUS.pendente },
    })
  }
}

/** (b) Executa os jobs vencidos. Devolve quantos foram enviados. */
export async function runDueFollowUps(): Promise<number> {
  const now = new Date()
  await rescueStaleJobs(now)
  // Só workspaces com follow-up ligado e WhatsApp conectado: desligado/desconectado = fila pausada (os jobs ficam).
  const due = await db.followUpJob.findMany({
    where: {
      status: STATUS.pendente,
      runAt: { lte: now },
      conversation: { workspace: { arquivadoEm: null, whatsappSession: { is: { status: 'CONECTADO' } }, followUpRule: { is: { enabled: true } } } },
    },
    orderBy: { runAt: 'asc' },
    take: 200,
    select: { id: true, conversationId: true, tentativa: true, conversation: { select: { workspaceId: true, workspace: { select: { timezone: true } } } } },
  })
  if (due.length === 0) return 0
  // Janela de envio (relógio de CADA espaço): reagenda para as 8h do espaço em vez de enviar de madrugada.
  const quiet = new Map<string, string[]>() // fuso -> ids
  const ready: typeof due = []
  for (const j of due) {
    const tz = normTz(j.conversation.workspace.timezone)
    if (inQuietHours(now, tz)) quiet.set(tz, [...(quiet.get(tz) ?? []), j.id])
    else ready.push(j)
  }
  for (const [tz, ids] of Array.from(quiet)) {
    await db.followUpJob.updateMany({ where: { id: { in: ids }, status: STATUS.pendente }, data: { runAt: nextHourTz(now, QUIET_END, tz) } })
  }
  let sent = 0
  const perWorkspace = new Map<string, number>()
  for (const job of ready) {
    const wsId = job.conversation.workspaceId
    if ((perWorkspace.get(wsId) ?? 0) >= MAX_SENDS_PER_WORKSPACE_PER_TICK) continue
    if (!(await automationAllowed(wsId))) {
      // Modo restrito: o job não sai (e é cancelado para não travar a fila); nenhum dado é apagado.
      await db.followUpJob.updateMany({ where: { id: job.id, status: STATUS.pendente }, data: { status: STATUS.cancelado, error: 'Assinatura inativa' } })
      continue
    }
    try {
      const claim = await db.followUpJob.updateMany({ where: { id: job.id, status: STATUS.pendente }, data: { status: STATUS.executando } })
      if (claim.count !== 1) continue
      const outcome = await executeJob({ id: job.id, conversationId: job.conversationId, tentativa: job.tentativa, timezone: normTz(job.conversation.workspace.timezone) })
      if (outcome !== 'ignorado') perWorkspace.set(wsId, (perWorkspace.get(wsId) ?? 0) + 1)
      if (outcome === 'enviado') sent++
    } catch (e) {
      logError('followup', `job ${job.id} falhou`, e)
      await db.followUpJob.updateMany({ where: { id: job.id, status: STATUS.executando }, data: { status: STATUS.erro, error: shortError(e) } })
    }
  }
  return sent
}
