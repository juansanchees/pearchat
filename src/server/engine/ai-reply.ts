import type { AiAgent, AiJob, Contact, Conversation, Message } from '@prisma/client'
import { db } from '@/lib/db'
import { generateReply, LlmError } from '@/server/agent/llm'
import type { ChatMessage } from '@/server/agent/llm'
import { buildSystemPrompt, HANDOFF_MARKER } from '@/server/agent/prompt'
import { serviceTypesForPrompt } from '@/server/calendar/service-types'
import { getBilling } from '@/server/settings/service'
import { loadConversationItem, toMessageDTO } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { canSendFreeformTo } from './freeform'
import { contactRef, OutboundError, sendAndRecord } from './outbound'
import { agentMayReplyAt, detectHandoffRule, genericHandoffMessage } from './rules'
import { bumpUsage, engineDisabled, getConnected, log, logError, shortError } from './util'

// Resposta da IA às conversas. Fluxo: ingestInboundMessage -> scheduleAiReply (debounce de 4 s) ->
// o agendador executa runDueAiJobs. Cada conjunto de mensagens seguidas do cliente gera UMA resposta.

export const AI_DEBOUNCE_MS = 4_000
const SWEEP_SPACING_MS = 1_200
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [15_000, 45_000]
const HISTORY_LIMIT = 20
const STALE_RUNNING_MS = 3 * 60_000
const SWEEP_LOOKBACK_MS = 24 * 3_600_000 // janela de 24 h do WhatsApp
const CONCURRENCY = 4

export const AI_JOB = { pendente: 'pendente', executando: 'executando', feito: 'feito', erro: 'erro' } as const

type Eligibility = { ok: true; agent: AiAgent; horarioAtendimento: string | null } | { ok: false; reason: string }

async function loadAgentFor(workspaceId: string, at: Date): Promise<Eligibility> {
  const [agent, ws] = await Promise.all([
    db.aiAgent.findUnique({ where: { workspaceId } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { horarioAtendimento: true } }),
  ])
  if (!agent?.enabled) return { ok: false, reason: 'IA desligada' }
  if (!agentMayReplyAt(agent.horario, ws?.horarioAtendimento ?? null, at)) return { ok: false, reason: 'fora do horário do agente' }
  return { ok: true, agent, horarioAtendimento: ws?.horarioAtendimento ?? null }
}

/**
 * Chamado pelo ingest depois de gravar a mensagem do cliente. Agenda (ou empurra) o job de resposta da IA
 * se as condições permitirem. Nunca lança: falha do motor não pode quebrar o recebimento.
 */
export async function scheduleAiReply(input: { workspaceId: string; conversationId: string; optOut: boolean }): Promise<void> {
  try {
    if (engineDisabled() || input.optOut) return
    const { workspaceId, conversationId } = input
    const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { mode: true } })
    if (!conv || conv.mode === 'HUMANO') return
    const el = await loadAgentFor(workspaceId, new Date())
    if (!el.ok) return
    if (!(await getConnected(workspaceId))) return

    const runAt = new Date(Date.now() + AI_DEBOUNCE_MS)
    // Debounce: já existe job pendente -> só empurra o horário.
    const pushed = await db.aiJob.updateMany({ where: { conversationId, workspaceId, status: AI_JOB.pendente }, data: { runAt } })
    if (pushed.count > 0) return
    await db.aiJob.create({ data: { workspaceId, conversationId, status: AI_JOB.pendente, runAt } })
  } catch (e) {
    logError('ai', 'falha ao agendar resposta', e)
  }
}

/**
 * Cria jobs para as conversas do workspace cuja última mensagem é do cliente e que ninguém respondeu
 * (ex.: IA ligada com mensagens pendentes). Espaça os jobs em 1,2 s. Devolve a quantidade criada.
 */
export async function enqueuePendingForWorkspace(workspaceId: string): Promise<number> {
  const now = new Date()
  const el = await loadAgentFor(workspaceId, now)
  if (!el.ok) return 0
  if (!(await getConnected(workspaceId))) return 0

  const convs = await db.conversation.findMany({
    where: {
      workspaceId,
      lastMessageAt: { gte: new Date(now.getTime() - SWEEP_LOOKBACK_MS) },
      OR: [{ mode: null }, { mode: { not: 'HUMANO' } }],
      contact: { optOut: false },
      aiJobs: { none: { status: { in: [AI_JOB.pendente, AI_JOB.executando] } } },
    },
    orderBy: { lastMessageAt: 'asc' },
    take: 200,
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })

  let created = 0
  for (const c of convs) {
    const last = c.messages[0]
    if (!last || last.direction !== 'IN') continue
    // Histórico importado do WhatsApp: a IA não responde a conversas anteriores à conexão.
    if (last.imported) continue
    // Mensagem recém-chegada: o ingest cuida dela (evita corrida com o debounce).
    if (now.getTime() - last.createdAt.getTime() < 6_000) continue
    // A mensagem chegou numa hora em que a IA podia responder? (senão é de atendimento humano)
    if (!agentMayReplyAt(el.agent.horario, el.horarioAtendimento, last.createdAt)) continue
    // Já tentamos responder depois dessa mensagem (feito/erro)?
    const handled = await db.aiJob.findFirst({ where: { conversationId: c.id, createdAt: { gte: last.createdAt } }, select: { id: true } })
    if (handled) continue
    await db.aiJob.create({
      data: { workspaceId, conversationId: c.id, status: AI_JOB.pendente, runAt: new Date(now.getTime() + AI_DEBOUNCE_MS + created * SWEEP_SPACING_MS) },
    })
    created++
  }
  if (created > 0) log('ai', `workspace ${workspaceId}: ${created} job(s) para pendentes`)
  return created
}

/** Varre os workspaces com IA ligada e WhatsApp conectado. */
export async function sweepPending(): Promise<number> {
  const agents = await db.aiAgent.findMany({
    where: { enabled: true, workspace: { whatsappSession: { is: { status: 'CONECTADO' } } } },
    select: { workspaceId: true },
  })
  let total = 0
  for (const a of agents) total += await enqueuePendingForWorkspace(a.workspaceId)
  return total
}

// ---- Execução ----

function toHistory(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const role: ChatMessage['role'] = m.direction === 'IN' ? 'user' : 'assistant'
    const content = m.body.trim() || (m.mediaUrl ? '[mídia enviada]' : '')
    if (!content) continue
    const prev = out[out.length - 1]
    if (prev && prev.role === role) prev.content += `\n${content}`
    else out.push({ role, content })
  }
  while (out[0]?.role === 'assistant') out.shift()
  return out
}

async function setTyping(workspaceId: string, conversationId: string, typing: boolean): Promise<void> {
  await db.conversation.update({ where: { id: conversationId }, data: { typing } })
  const item = await loadConversationItem(workspaceId, conversationId)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
}

async function responsavelNome(workspaceId: string): Promise<string> {
  const u = await db.user.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { nome: true } })
  return u?.nome.trim().split(/\s+/)[0] || 'o responsável'
}

type JobResult = { kind: 'done'; note?: string } | { kind: 'retry'; error: string }

async function finish(job: AiJob, status: 'feito' | 'erro', note?: string): Promise<void> {
  await db.aiJob.update({ where: { id: job.id }, data: { status, error: note ?? null } })
}

async function handoff(opts: {
  session: NonNullable<Awaited<ReturnType<typeof getConnected>>>
  conv: Conversation & { contact: Contact }
  motivo: string
  message: string | null
}): Promise<void> {
  const { session, conv, motivo, message } = opts
  const { workspaceId } = session
  if (message) {
    try {
      await sendAndRecord({
        session,
        conversationId: conv.id,
        to: contactRef(conv.contact),
        author: 'IA',
        content: { kind: 'text', text: message },
        countAtendimento: true,
        emit: false,
      })
    } catch (e) {
      // Mesmo sem conseguir avisar o cliente, a conversa vai para a pessoa.
      logError('ai', `aviso de passagem falhou (conversa ${conv.id})`, e)
    }
  }
  await db.conversation.update({ where: { id: conv.id }, data: { mode: 'HUMANO', typing: false } })
  const msg = message ? await db.message.findFirst({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' } }) : null
  if (msg && msg.direction === 'OUT') {
    emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId: conv.id, message: toMessageDTO(msg) })
  }
  const item = await loadConversationItem(workspaceId, conv.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  emitToWorkspace(workspaceId, 'handoff.requested', { workspaceId, conversationId: conv.id, contactName: conv.contact.nome, motivo })
  log('ai', `passagem para humano (conversa ${conv.id}): ${motivo}`)
}

async function execute(job: AiJob): Promise<JobResult> {
  const { workspaceId, conversationId } = job
  const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
  if (!conv) return { kind: 'done', note: 'cancelado: conversa não existe' }
  if (conv.mode === 'HUMANO') return { kind: 'done', note: 'cancelado: conversa em modo humano' }
  if (conv.contact.optOut) return { kind: 'done', note: 'cancelado: contato pediu para parar' }
  const el = await loadAgentFor(workspaceId, new Date())
  if (!el.ok) return { kind: 'done', note: `cancelado: ${el.reason}` }
  const session = await getConnected(workspaceId)
  if (!session) return { kind: 'done', note: 'cancelado: WhatsApp desconectado' }

  const recent = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT })
  const last = recent[0]
  if (!last || last.direction !== 'IN') return { kind: 'done', note: 'nada a responder (já respondida)' }
  const history = toHistory([...recent].reverse())
  if (history.length === 0) return { kind: 'done', note: 'nada a responder' }
  // Tudo que o cliente mandou desde a nossa última mensagem.
  const unanswered: string[] = []
  for (const m of recent) {
    if (m.direction !== 'IN') break
    unanswered.unshift(m.body)
  }
  const customerText = unanswered.join('\n')

  const to = contactRef(conv.contact)
  const responsavel = await responsavelNome(workspaceId)
  const { agent } = el

  // Limite de respostas de IA do plano.
  const billing = await getBilling(workspaceId)
  const limite = billing.limites.respostasIa
  if (limite !== null && billing.uso.respostasIa >= limite) {
    await handoff({ session, conv, motivo: 'limite do plano', message: null })
    return { kind: 'done', note: 'limite de respostas de IA do plano' }
  }

  // Regras de passagem por palavra-chave: antes de chamar o modelo.
  const hit = detectHandoffRule(customerText, agent.handoffRules)
  if (hit) {
    await handoff({ session, conv, motivo: hit.motivo, message: hit.mensagem(responsavel) })
    return { kind: 'done', note: `passagem: ${hit.motivo}` }
  }

  if (!(await canSendFreeformTo(session, to))) return { kind: 'done', note: 'fora da janela de 24h: só modelos aprovados' }

  await setTyping(workspaceId, conversationId, true)

  const [ws, kb, servicos] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true } }),
    db.knowledgeItem.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: 'asc' } }),
    serviceTypesForPrompt(workspaceId),
  ])
  const system = buildSystemPrompt({
    empresa: ws.nome,
    agente: { nome: agent.nome, tom: tomFromDb(agent.tom), prompt: agent.prompt },
    kb: kb.map((k) => ({ pergunta: k.pergunta, resposta: k.resposta })),
    handoffRules: agent.handoffRules,
    servicos,
  })

  let texto: string
  try {
    const r = await generateReply({ system, messages: history })
    texto = r.texto
  } catch (e) {
    return { kind: 'retry', error: e instanceof LlmError ? e.message : shortError(e) }
  }

  // Revalida: a conversa pode ter virado HUMANO, a IA ter sido desligada, ou chegado mais mensagens.
  const [conv2, el2, newest] = await Promise.all([
    db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { mode: true } }),
    loadAgentFor(workspaceId, new Date()),
    db.message.findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
  ])
  if (!conv2 || conv2.mode === 'HUMANO') return { kind: 'done', note: 'cancelado: virou modo humano durante a geração' }
  if (!el2.ok) return { kind: 'done', note: `cancelado: ${el2.reason}` }
  if (newest?.id !== last.id) return { kind: 'done', note: 'superado: chegou mensagem nova durante a geração' }

  if (texto.includes(HANDOFF_MARKER)) {
    await handoff({ session, conv, motivo: 'regra de passagem (decisão da IA)', message: genericHandoffMessage(responsavel) })
    return { kind: 'done', note: 'passagem pelo modelo' }
  }

  try {
    const sent = await sendAndRecord({
      session,
      conversationId,
      to,
      author: 'IA',
      content: { kind: 'text', text: texto },
      countAtendimento: true,
      emit: false,
    })
    await db.conversation.update({ where: { id: conversationId }, data: { mode: 'IA', typing: false, unread: 0 } })
    await bumpUsage(workspaceId, { respostasIa: 1 })
    emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId, message: toMessageDTO(sent) })
    const item = await loadConversationItem(workspaceId, conversationId)
    if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    return { kind: 'done' }
  } catch (e) {
    return { kind: 'retry', error: e instanceof OutboundError ? e.message : shortError(e) }
  }
}

function tomFromDb(tom: string): 'Amigável' | 'Profissional' | 'Direto' {
  return tom === 'profissional' ? 'Profissional' : tom === 'direto' ? 'Direto' : 'Amigável'
}

/** Reivindica e executa um job. Devolve false se outra instância o levou. */
async function runJob(job: AiJob): Promise<boolean> {
  const claim = await db.aiJob.updateMany({
    where: { id: job.id, status: AI_JOB.pendente },
    data: { status: AI_JOB.executando, attempts: { increment: 1 }, runAt: new Date() },
  })
  if (claim.count !== 1) return false
  const attempts = job.attempts + 1
  const { workspaceId, conversationId } = job

  let result: JobResult
  try {
    result = await execute(job)
  } catch (e) {
    result = { kind: 'retry', error: shortError(e) }
  }

  try {
    if (result.kind === 'done') {
      await finish(job, 'feito', result.note)
    } else if (attempts < MAX_ATTEMPTS) {
      const wait = RETRY_DELAYS_MS[attempts - 1] ?? 45_000
      await db.aiJob.update({
        where: { id: job.id },
        data: { status: AI_JOB.pendente, runAt: new Date(Date.now() + wait), error: result.error },
      })
      log('ai', `job ${job.id} falhou (tentativa ${attempts}/${MAX_ATTEMPTS}); nova tentativa em ${wait / 1000}s`)
    } else {
      await finish(job, 'erro', result.error)
      logError('ai', `job ${job.id} esgotou tentativas`, new Error(result.error))
    }
  } finally {
    // Em qualquer saída (inclusive passagem/cancelamento) a conversa não fica "digitando".
    try {
      const c = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { typing: true } })
      if (c?.typing) await setTyping(workspaceId, conversationId, false)
    } catch (e) {
      logError('ai', 'falha ao limpar typing', e)
    }
  }
  return true
}

/** Executa os jobs de IA vencidos (até 4 conversas em paralelo). Devolve quantos rodaram. */
export async function runDueAiJobs(): Promise<number> {
  const now = new Date()
  // Recupera jobs presos em "executando" (processo caiu no meio).
  await db.aiJob.updateMany({
    where: { status: AI_JOB.executando, runAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
    data: { status: AI_JOB.pendente },
  })
  const dueAll = await db.aiJob.findMany({
    where: { status: AI_JOB.pendente, runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: 20,
  })
  // Uma conversa por vez: duplicatas ficam para o próximo tick (que as vê já respondidas).
  const seen = new Set<string>()
  const due = dueAll.filter((j) => !seen.has(j.conversationId) && seen.add(j.conversationId))
  let ran = 0
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY)
    const res = await Promise.allSettled(batch.map((j) => runJob(j)))
    for (const r of res) {
      if (r.status === 'fulfilled' && r.value) ran++
      else if (r.status === 'rejected') logError('ai', 'job falhou', r.reason)
    }
  }
  return ran
}
