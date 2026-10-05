import type { AiAgent, AiJob, Contact, Conversation, Message } from '@prisma/client'
import { db } from '@/lib/db'
import { generateReply, LlmError } from '@/server/agent/llm'
import type { ChatMessage } from '@/server/agent/llm'
import { detectReplyLanguage, FIXED, LIMITE_TODOS, parseIdiomaConfig, resolveReplyLanguage } from '@/server/agent/i18n'
import { buildSystemPrompt, HANDOFF_MARKER } from '@/server/agent/prompt'
import { createToolRunner, miniCalendar } from '@/server/agent/tools'
import { remarcarContext } from '@/server/calendar/confirmation'
import { serviceTypesForPrompt } from '@/server/calendar/service-types'
import { transcriptionAvailable, visionAvailable } from '@/server/media/ai-caps'
import { isMediaKind, MEDIA_LABEL, isMediaLabel } from '@/server/media/mime'
import { getMediaStore } from '@/server/media/store'
import { getAiQuota } from '@/server/settings/service'
import { notifySpaceAttention } from '@/server/spaces/attention'
import { loadConversationItem, toMessageDTO } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { canSendFreeformTo } from './freeform'
import { automationAllowed } from '@/server/billing/entitlements'
import { HANDOFF_BILLING_NOTE, HANDOFF_LIMIT_NOTE, HANDOFF_MODEL_NOTE, handoffRuleNote } from './handoff-reasons'
import { contactRef, OutboundAlreadySentError, OutboundCancelledError, OutboundError, sendAndRecord } from './outbound'
import { cancelPendingFollowUps } from './followup'
import { isManualNote, keepManual, plainNote } from './ai-job-notes'
import { isNonReplyableBody } from '@/server/whatsapp/labels'
import { agentMayReplyAt, detectHandoffRule, formatAgora, genericHandoffMessage, isStopRequest, ungroundedMoney } from './rules'
import { aiConcurrency, engineLimiter, engineStopping } from './limiter'
import { bumpUsage, displayName, engineDisabled, getConnected, log, logError, shortError } from './util'

// Resposta da IA às conversas. Fluxo: ingestInboundMessage -> scheduleAiReply (debounce de 4 s) ->
// o agendador executa runDueAiJobs. Cada conjunto de mensagens seguidas do cliente gera UMA resposta.

export const AI_DEBOUNCE_MS = 4_000
const SWEEP_SPACING_MS = 1_200
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [15_000, 45_000]
const HISTORY_LIMIT = 30
const MAX_MESSAGE_CHARS = 1500 // trava o custo se o cliente colar um texto enorme
// Job pode levar ~2,5 min (modelo 70 s + nova tentativa de preço 70 s + ferramentas): 5 min sem terminar = processo caiu.
// Na subida do servidor os órfãos voltam na hora (recoverOrphanAiJobs); este prazo cobre outra instância que morreu.
const STALE_RUNNING_MS = 5 * 60_000
const SWEEP_LOOKBACK_MS = 24 * 3_600_000 // janela de 24 h do WhatsApp
// Espera por transcrição/download de mídia antes de responder: até 3 vezes, 7 s cada (~20 s no total).
const MEDIA_WAIT_MS = 7_000
const MEDIA_WAIT_MAX = 3
const MEDIA_WAIT_NOTE = 'aguardando-midia:'
const VISION_MAX_BYTES = 4 * 1024 * 1024
const VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const RUN_BUDGET_MS = 30_000 // tempo máximo de uma passada do runDueAiJobs

const NOT_FAILED_OUT = { NOT: { direction: 'OUT' as const, status: 'FALHOU' as const } }

// Notas de jobs cancelados que não significam "cliente atendido" (ver enqueuePendingForWorkspace).
const RETRY_CANCEL_NOTES = ['cancelado: WhatsApp desconectado', 'cancelado: IA desligada']

export const AI_JOB = { pendente: 'pendente', executando: 'executando', feito: 'feito', erro: 'erro' } as const

type Eligibility = { ok: true; agent: AiAgent; horarioAtendimento: string | null } | { ok: false; reason: string }

async function loadAgentFor(workspaceId: string, at: Date, opts: { ignoreSchedule?: boolean } = {}): Promise<Eligibility> {
  const [agent, ws] = await Promise.all([
    db.aiAgent.findUnique({ where: { workspaceId } }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { horarioAtendimento: true } }),
  ])
  if (!agent?.enabled) return { ok: false, reason: 'IA desligada' }
  // Pedido de uma pessoa ("Responder com a IA"): ela decidiu agora, o horário do agente não a segura.
  if (!opts.ignoreSchedule && !agentMayReplyAt(agent.horario, ws?.horarioAtendimento ?? null, at)) return { ok: false, reason: 'fora do horário do agente' }
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

  // Candidatas: última mensagem é do cliente, não importada, com mais de 6 s (o ingest cuida das recém-chegadas)
  // e que chegou numa hora em que a IA podia responder (senão é de atendimento humano).
  const candidates = convs.filter((c) => {
    const last = c.messages[0]
    return (
      !!last &&
      last.direction === 'IN' &&
      !last.imported &&
      (!!last.mediaType || !isNonReplyableBody(last.body)) &&
      now.getTime() - last.createdAt.getTime() >= 6_000 &&
      now.getTime() - last.createdAt.getTime() < SWEEP_LOOKBACK_MS &&
      agentMayReplyAt(el.agent.horario, el.horarioAtendimento, last.createdAt)
    )
  })
  // Já tentamos responder depois dessa mensagem (feito/erro)? Uma consulta só, em vez de uma por conversa.
  const handledIds = new Set<string>()
  if (candidates.length > 0) {
    const oldest = candidates.reduce((min, c) => Math.min(min, c.messages[0]!.createdAt.getTime()), Infinity)
    const jobs = await db.aiJob.findMany({
      where: { conversationId: { in: candidates.map((c) => c.id) }, createdAt: { gte: new Date(oldest) } },
      select: { conversationId: true, createdAt: true, status: true, error: true },
    })
    for (const j of jobs) {
      // Job cancelado só porque o WhatsApp caiu / a IA estava desligada NÃO conta como tentativa: a mensagem
      // continua sem resposta e a varredura a reconsidera (a mensagem tem menos de 24 h e não é importada).
      if (j.status === AI_JOB.feito && j.error && RETRY_CANCEL_NOTES.some((n) => j.error!.startsWith(n))) continue
      const c = candidates.find((x) => x.id === j.conversationId)
      if (c && j.createdAt.getTime() >= c.messages[0]!.createdAt.getTime()) handledIds.add(c.id)
    }
  }

  let created = 0
  for (const c of candidates) {
    if (handledIds.has(c.id)) continue
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
    where: { enabled: true, workspace: { arquivadoEm: null, whatsappSession: { is: { status: 'CONECTADO' } } } },
    select: { workspaceId: true },
  })
  let total = 0
  for (const a of agents) {
    if (engineStopping()) break
    // Uma vaga das tarefas do motor por workspace varrido (não monopoliza o pool nem as vagas da IA).
    total += await engineLimiter('tarefas').run(() => enqueuePendingForWorkspace(a.workspaceId))
  }
  return total
}

// ---- Execução ----

/** Texto de uma mensagem para a IA: áudio transcrito vira "[Áudio transcrito] ..."; mídia com legenda leva o rótulo. */
export function aiTextOf(m: Message): string {
  if (m.direction === 'IN' && m.mediaType === 'audio' && m.transcriptStatus === 'feito' && m.transcript?.trim()) {
    return `[Áudio transcrito] ${m.transcript.trim()}`
  }
  const body = m.body.trim()
  if (m.mediaType && isMediaKind(m.mediaType) && body && !isMediaLabel(body)) return `${MEDIA_LABEL[m.mediaType]} ${body}`
  return body || (m.mediaUrl ? '[mídia enviada]' : '')
}

/** O que o cliente "disse" (para detectar parar/passagem): a transcrição do áudio, se houver, senão o texto. */
function customerTextOf(m: Message): string {
  return m.mediaType === 'audio' && m.transcriptStatus === 'feito' && m.transcript?.trim() ? m.transcript.trim() : m.body
}

function toHistory(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const role: ChatMessage['role'] = m.direction === 'IN' ? 'user' : 'assistant'
    const raw = aiTextOf(m)
    const content = raw.length > MAX_MESSAGE_CHARS ? `${raw.slice(0, MAX_MESSAGE_CHARS)}…` : raw
    if (!content) continue
    const prev = out[out.length - 1]
    if (prev && prev.role === role) prev.content += `\n${content}`
    else out.push({ role, content })
  }
  while (out[0]?.role === 'assistant') out.shift()
  return out
}

/** O job anterior desta conversa gravou algo na agenda mas a resposta foi descartada (chegou mensagem nova)? */
async function discardedWriteNotice(conversationId: string, since: Date): Promise<string[]> {
  const prev = await db.aiJob.findFirst({
    where: { conversationId, status: AI_JOB.feito, error: { startsWith: 'superado' }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { ferramentas: true },
  })
  const list = Array.isArray(prev?.ferramentas) ? (prev?.ferramentas as { nome?: unknown; ok?: unknown }[]) : []
  const wrote = list.some((f) => f.ok === true && ['criar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento'].includes(String(f.nome)))
  return wrote
    ? ['Numa resposta anterior sua, uma ferramenta de escrita (criar, remarcar ou cancelar) já foi executada, mas a mensagem ao cliente não foi enviada. Chame consultar_agendamentos para ver o estado atual e informe o cliente do que foi feito.']
    : []
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

/**
 * `wait`: reagenda sem decidir. `consumeAttempt` = conta como tentativa (envio que saiu sem confirmação); sem ele a
 * espera não gasta tentativa (mídia baixando, conferência de um envio anterior).
 */
type JobResult = { kind: 'done'; note?: string } | { kind: 'retry'; error: string } | { kind: 'wait'; note: string; delayMs?: number; consumeAttempt?: boolean }

/** Chave de idempotência do envio da resposta de um job (Message.sendKey): o mesmo job nunca envia duas respostas. */
export const aiSendKey = (jobId: string): string => `ai:${jobId}`
/** Espera entre conferências de um envio sem confirmação (a reconciliação resolve em até ~3 min). */
const DELIVERY_RECHECK_MS = 20_000
const DELIVERY_WAIT_NOTE = 'aguardando-confirmacao:'
/** Teto de conferências (~33 min: cobre o prazo máximo da reconciliação com a Evolution fora do ar). */
const DELIVERY_WAIT_MAX = 100

/**
 * Revalidação IMEDIATAMENTE antes de enviar: pessoa assumiu (HUMANO) = não envia. Também não envia se o desligamento
 * gracioso já devolveu este job à fila (o próximo processo o executa; sem isto sairiam duas respostas).
 */
async function humanGuard(conversationId: string, jobId?: string): Promise<string | null> {
  if (jobId && releasedJobs.has(jobId)) return 'servidor desligando: o job voltou para a fila'
  const c = await db.conversation.findUnique({ where: { id: conversationId }, select: { mode: true } })
  if (!c) return 'conversa não existe'
  return c.mode === 'HUMANO' ? 'virou modo humano antes do envio' : null
}

function deliveryWait(job: AiJob): JobResult {
  const done = Number(new RegExp(`^${DELIVERY_WAIT_NOTE}(\\d+)`).exec(plainNote(job.error))?.[1] ?? 0)
  if (done >= DELIVERY_WAIT_MAX) return { kind: 'done', note: 'envio sem confirmação: a reconciliação não concluiu a tempo' }
  return { kind: 'wait', note: `${DELIVERY_WAIT_NOTE}${done + 1}`, delayMs: DELIVERY_RECHECK_MS }
}

async function finish(job: AiJob, status: 'feito' | 'erro', note?: string): Promise<void> {
  await db.aiJob.update({ where: { id: job.id }, data: { status, error: note ?? null } })
}

async function handoff(opts: {
  session: NonNullable<Awaited<ReturnType<typeof getConnected>>>
  conv: Conversation & { contact: Contact }
  motivo: string
  message: string | null
  /** Job que fez a passagem: o aviso ao cliente sai uma vez só por job (retomada após queda não repete). */
  jobId?: string
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
        ...(opts.jobId ? { sendKey: `${aiSendKey(opts.jobId)}:passagem` } : {}),
        guard: () => humanGuard(conv.id, opts.jobId),
      })
    } catch (e) {
      // Mesmo sem conseguir avisar o cliente (ou já avisado/assumido), a conversa vai para a pessoa.
      if (!(e instanceof OutboundAlreadySentError) && !(e instanceof OutboundCancelledError)) logError('ai', `aviso de passagem falhou (conversa ${conv.id})`, e)
    }
  }
  await db.conversation.update({ where: { id: conv.id }, data: { mode: 'HUMANO', typing: false } })
  const msg = message ? await db.message.findFirst({ where: { conversationId: conv.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) : null
  if (msg && msg.direction === 'OUT') {
    emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId: conv.id, message: toMessageDTO(msg) })
  }
  const item = await loadConversationItem(workspaceId, conv.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  emitToWorkspace(workspaceId, 'handoff.requested', { workspaceId, conversationId: conv.id, contactName: conv.contact.nome, motivo })
  await notifySpaceAttention(workspaceId, { contato: conv.contact.nome, motivo })
  log('ai', `passagem para humano (conversa ${conv.id}): ${motivo}`)
}

/** Grava no job as chamadas de ferramenta (nome, ok, código do erro; sem dados pessoais). */
async function saveToolLog(job: AiJob, runner: ReturnType<typeof createToolRunner> | null): Promise<void> {
  if (!runner || runner.log.length === 0) return
  try {
    await db.aiJob.update({ where: { id: job.id }, data: { ferramentas: runner.log } })
  } catch (e) {
    logError('ai', 'falha ao gravar o registro de ferramentas', e)
  }
}

async function execute(job: AiJob): Promise<JobResult> {
  const { workspaceId, conversationId } = job
  const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
  if (!conv) return { kind: 'done', note: 'cancelado: conversa não existe' }
  if (conv.mode === 'HUMANO') return { kind: 'done', note: 'cancelado: conversa em modo humano' }
  if (conv.contact.optOut) return { kind: 'done', note: 'cancelado: contato pediu para parar' }
  const manual = isManualNote(job.error) // criado por pedido (ver ai-job-notes.ts)
  const el = await loadAgentFor(workspaceId, new Date(), { ignoreSchedule: manual })
  if (!el.ok) return { kind: 'done', note: `cancelado: ${el.reason}` }
  const session = await getConnected(workspaceId)
  if (!session) return { kind: 'done', note: 'cancelado: WhatsApp desconectado' }

  // Este job já enviou (retomada depois de queda/reinício, ou envio sem confirmação): nunca gera/envia de novo às cegas.
  const prior = await db.message.findFirst({ where: { conversationId, sendKey: aiSendKey(job.id) }, select: { status: true, createdAt: true } })
  if (prior && prior.status === 'PENDENTE') return deliveryWait(job)
  if (prior && prior.status !== 'FALHOU') {
    // O cliente escreveu de novo enquanto este envio era conferido: a nova mensagem ganha um job próprio já.
    const newest = await db.message.findFirst({ where: { conversationId, ...NOT_FAILED_OUT }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { direction: true, createdAt: true } })
    if (newest?.direction === 'IN' && newest.createdAt > prior.createdAt) {
      await db.aiJob.create({ data: { workspaceId, conversationId, status: AI_JOB.pendente, runAt: new Date(Date.now() + AI_DEBOUNCE_MS) } })
    }
    return { kind: 'done', note: 'já enviada por este job' }
  }

  // Envios que falharam (OUT/FALHOU) não contam: senão a nova tentativa acharia que a conversa já foi respondida.
  const recent = await db.message.findMany({ where: { conversationId, ...NOT_FAILED_OUT }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT })
  const last = recent[0]
  if (!last || last.direction !== 'IN') return { kind: 'done', note: 'nada a responder (já respondida)' }
  // Histórico importado do WhatsApp não gera resposta sozinho; só um pedido de uma pessoa ("Responder com a IA") o responde.
  if (last.imported && !manual) return { kind: 'done', note: 'nada a responder (mensagem importada)' }
  // Chamada, enquete, convite ou tipo desconhecido não é o cliente falando.
  if (!last.mediaType && isNonReplyableBody(last.body)) return { kind: 'done', note: 'nada a responder (evento do sistema)' }
  // Tudo que o cliente mandou desde a nossa última mensagem.
  const unansweredMsgs: Message[] = []
  for (const m of recent) {
    if (m.direction !== 'IN') break
    unansweredMsgs.unshift(m)
  }

  // Áudio ainda sendo baixado/transcrito (ou imagem ainda baixando, com visão): espera um pouco antes de responder.
  const visionOn = visionAvailable()
  const waiting = unansweredMsgs.some(
    (m) => !m.imported && ((m.mediaType === 'audio' && m.transcriptStatus === 'pendente') || (visionOn && m.id === last.id && m.mediaType === 'image' && m.mediaStatus === 'pendente')),
  )
  if (waiting) {
    const done = Number(new RegExp(`^${MEDIA_WAIT_NOTE}(\\d+)`).exec(plainNote(job.error))?.[1] ?? 0)
    if (done < MEDIA_WAIT_MAX) return { kind: 'wait', note: `${MEDIA_WAIT_NOTE}${done + 1}` }
  }

  const history = toHistory([...recent].reverse())
  if (history.length === 0) return { kind: 'done', note: 'nada a responder' }
  const customerText = unansweredMsgs.map(customerTextOf).join('\n')

  // "parar"/"sair" e variações: marca opt-out e não responde (o ingest só pega a palavra exata).
  if (isStopRequest(customerText)) {
    await db.contact.update({ where: { id: conv.contact.id }, data: { optOut: true } })
    await cancelPendingFollowUps(conversationId, 'Cliente pediu para parar').catch((e) => logError('ai', 'cancelar follow-ups do opt-out', e))
    return { kind: 'done', note: 'cliente pediu para parar: opt-out registrado' }
  }

  const to = contactRef(conv.contact)
  const responsavel = await responsavelNome(workspaceId)
  const { agent } = el
  // Idioma da resposta: o configurado, ou (em auto) o da última mensagem do cliente. Também escolhe os textos fixos abaixo.
  const idioma = parseIdiomaConfig(agent.idioma)
  const lang = resolveReplyLanguage(idioma, history)

  // Modo restrito (teste vencido / pagamento atrasado além da carência / assinatura cancelada e vencida): a IA não
  // responde; a conversa vai para uma pessoa em silêncio (nada é dito ao cliente) e o dono é avisado como em qualquer passagem.
  if (!(await automationAllowed(workspaceId))) {
    await handoff({ session, conv, jobId: job.id, motivo: 'assinatura inativa', message: null })
    return { kind: 'done', note: HANDOFF_BILLING_NOTE }
  }

  // Limite de respostas de IA do plano.
  const quota = await getAiQuota(workspaceId)
  if (quota.limite !== null && quota.usadas >= quota.limite) {
    // Avisa o cliente UMA vez (sem falar de plano/limite) antes de passar para a equipe.
    const jaAvisou = await db.message.findFirst({ where: { conversationId, author: 'IA', body: { in: LIMITE_TODOS } }, select: { id: true } })
    await handoff({ session, conv, jobId: job.id, motivo: 'limite do plano', message: jaAvisou ? null : FIXED[lang].limite })
    return { kind: 'done', note: HANDOFF_LIMIT_NOTE }
  }

  // Regras de passagem por palavra-chave: antes de chamar o modelo.
  const hit = detectHandoffRule(customerText, agent.handoffRules)
  if (hit) {
    await handoff({ session, conv, jobId: job.id, motivo: hit.motivo, message: hit.mensagem(responsavel, lang) })
    return { kind: 'done', note: handoffRuleNote(hit.motivo) }
  }

  if (!(await canSendFreeformTo(session, to))) return { kind: 'done', note: 'fora da janela de 24h: só modelos aprovados' }

  await setTyping(workspaceId, conversationId, true)

  const [ws, kb, servicos] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true } }),
    db.knowledgeItem.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: 'asc' } }),
    serviceTypesForPrompt(workspaceId),
  ])
  // Agendamento pela IA: só com a opção ligada no agente (fonte única: AiAgent.canSchedule) e ao menos um serviço cadastrado.
  const schedulingOn = agent.canSchedule && servicos.length > 0
  const nowDate = new Date()
  const runner = schedulingOn ? createToolRunner({ workspaceId, conversationId, contactId: conv.contactId }) : null
  const agendaCtx = schedulingOn
    ? {
        calendario: miniCalendar(nowDate),
        clienteNome: displayName(conv.contact.nome, conv.contact) || null,
        contexto: [...(await remarcarContext(workspaceId, conv.contactId, nowDate)), ...(await discardedWriteNotice(conversationId, new Date(nowDate.getTime() - 15 * 60_000)))],
      }
    : undefined
  const system = buildSystemPrompt({
    empresa: ws.nome,
    agente: { nome: agent.nome, tom: tomFromDb(agent.tom), prompt: agent.prompt },
    kb: kb.map((k) => ({ pergunta: k.pergunta, resposta: k.resposta })),
    handoffRules: agent.handoffRules,
    servicos,
    horarioAtendimento: el.horarioAtendimento,
    agora: formatAgora(new Date()),
    midia: { audio: transcriptionAvailable(), imagem: visionOn },
    agenda: agendaCtx,
    idioma,
    idiomaDetectado: idioma === 'auto' ? detectReplyLanguage(history) : null,
  })

  // Visão: a imagem da ÚLTIMA mensagem do cliente (até 4 MB, formato aceito pelos modelos) segue junto da legenda.
  if (visionOn && last.mediaType === 'image' && last.mediaStatus === 'ok' && last.mediaKey && (last.mediaSize ?? 0) <= VISION_MAX_BYTES && VISION_MIMES.has(last.mediaMime ?? '')) {
    const bytes = await getMediaStore().read(last.mediaKey, VISION_MAX_BYTES).catch(() => null)
    const target = history[history.length - 1]
    if (bytes && target?.role === 'user') target.image = { mime: last.mediaMime ?? 'image/jpeg', base64: bytes.toString('base64') }
  }

  let texto: string
  try {
    // Só o que o dono escreveu + o histórico (as regras fixas do prompt também têm números, ex.: "300 caracteres").
    const corpus = [agent.prompt, ...kb.map((k) => `${k.pergunta} ${k.resposta}`), ...servicos.map((s) => s.nome), ...history.map((m) => m.content)].join('\n')
    const r = await generateReply({ system, messages: history, tools: runner ?? undefined })
    texto = r.texto
    // Preço inventado: uma nova tentativa avisando; se insistir, resposta segura (sem valor).
    if (!texto.includes(HANDOFF_MARKER) && ungroundedMoney(texto, corpus).length > 0) {
      const r2 = await generateReply({
        system: `${system}\n\nATENÇÃO: sua resposta anterior citou um valor em reais que NÃO está nas informações acima. Responda de novo sem citar nenhum valor que não esteja escrito literalmente nas instruções ou respostas prontas; diga que vai confirmar com a equipe.`,
        messages: history,
        tools: runner ?? undefined,
      })
      texto = ungroundedMoney(r2.texto, corpus).length > 0 ? FIXED[lang].valorSeguro : r2.texto
    }
  } catch (e) {
    await saveToolLog(job, runner)
    return { kind: 'retry', error: e instanceof LlmError ? e.message : shortError(e) }
  }
  await saveToolLog(job, runner)

  // Revalida: a conversa pode ter virado HUMANO, a IA ter sido desligada, ou chegado mais mensagens.
  const [conv2, el2, newest] = await Promise.all([
    db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { mode: true } }),
    loadAgentFor(workspaceId, new Date(), { ignoreSchedule: manual }),
    db.message.findFirst({ where: { conversationId, ...NOT_FAILED_OUT }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } }),
  ])
  if (!conv2 || conv2.mode === 'HUMANO') return { kind: 'done', note: 'cancelado: virou modo humano durante a geração' }
  if (!el2.ok) return { kind: 'done', note: `cancelado: ${el2.reason}` }
  if (newest?.id !== last.id) return { kind: 'done', note: 'superado: chegou mensagem nova durante a geração' }

  if (texto.includes(HANDOFF_MARKER)) {
    await handoff({ session, conv, jobId: job.id, motivo: 'regra de passagem (decisão da IA)', message: genericHandoffMessage(responsavel, lang) })
    return { kind: 'done', note: HANDOFF_MODEL_NOTE }
  }

  let sent: Message
  try {
    sent = await sendAndRecord({
      session,
      conversationId,
      to,
      author: 'IA',
      content: { kind: 'text', text: stripRepeatedGreeting(texto, history) },
      countAtendimento: true,
      emit: false,
      sendKey: aiSendKey(job.id),
      // Pessoa assumiu entre a revalidação e o envio: não envia.
      guard: () => humanGuard(conversationId, job.id),
    })
  } catch (e) {
    if (e instanceof OutboundCancelledError) return { kind: 'done', note: `cancelado: ${e.message}` }
    if (e instanceof OutboundAlreadySentError) return { kind: 'done', note: 'já enviada por este job' }
    return { kind: 'retry', error: e instanceof OutboundError ? e.message : shortError(e) }
  }
  // A mensagem saiu (ou pode ter saído): daqui em diante nada pode levar a reenviar.
  try {
    // Nunca sobrescreve HUMANO: se uma pessoa assumiu durante o envio, a conversa continua com ela (A1).
    await db.conversation.updateMany({ where: { id: conversationId, OR: [{ mode: null }, { mode: { not: 'HUMANO' } }] }, data: { mode: 'IA', typing: false, unread: 0 } })
    await bumpUsage(workspaceId, { respostasIa: 1 })
    emitToWorkspace(workspaceId, 'message.received', { workspaceId, conversationId, message: toMessageDTO(sent) })
    const item = await loadConversationItem(workspaceId, conversationId)
    if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  } catch (e) {
    logError('ai', `pós-envio falhou (job ${job.id}); a resposta foi enviada`, e)
  }
  // Sem confirmação do provedor: espera a reconciliação (confirma = pronto; não confirmado = gera e envia de novo).
  if (sent.uncertainSince) return { kind: 'wait', note: `${DELIVERY_WAIT_NOTE}0`, delayMs: DELIVERY_RECHECK_MS, consumeAttempt: true }
  return { kind: 'done' }
}

/**
 * Rede de segurança: se a conversa já tem resposta nossa, o modelo às vezes ainda abre com "Oi!"/"Olá!".
 * Tira só a saudação solta do começo ("Oi, Maria!" com nome fica).
 */
export function stripRepeatedGreeting(texto: string, history: ChatMessage[]): string {
  if (!history.some((m) => m.role === 'assistant')) return texto
  const rest = texto.replace(/^\s*(?:oi|ol[aá]|hola|hi|hello|hey)\s*[!.]+\s*/i, '')
  if (rest === texto || rest.trim().length < 3) return texto
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function tomFromDb(tom: string): 'Amigável' | 'Profissional' | 'Direto' {
  return tom === 'profissional' ? 'Profissional' : tom === 'direto' ? 'Direto' : 'Amigável'
}

// Jobs que ESTE processo está executando (desligamento gracioso devolve à fila o que não terminou a tempo) e os que já
// foram devolvidos (não enviam nem gravam mais nada: o job pertence ao próximo processo).
const gr = globalThis as unknown as { __pearchat_ai_running?: Set<string>; __pearchat_ai_released?: Set<string> }
const runningJobs = (gr.__pearchat_ai_running ??= new Set<string>())
const releasedJobs = (gr.__pearchat_ai_released ??= new Set<string>())

export const HANDOFF_FAILURE_MOTIVO = 'a IA não conseguiu responder (falha temporária)'

/**
 * A IA esgotou as tentativas (modelo fora do ar, WhatsApp recusando...): a conversa vai para uma pessoa, em silêncio para
 * o cliente, e a equipe é avisada (sem isso o cliente ficaria sem resposta e ninguém saberia).
 */
async function escalateAfterFailure(job: AiJob): Promise<void> {
  const { workspaceId, conversationId } = job
  const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
  if (!conv || conv.mode === 'HUMANO') return
  const r = await db.conversation.updateMany({ where: { id: conversationId, OR: [{ mode: null }, { mode: { not: 'HUMANO' } }] }, data: { mode: 'HUMANO', typing: false } })
  if (r.count !== 1) return
  const item = await loadConversationItem(workspaceId, conversationId)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
  emitToWorkspace(workspaceId, 'handoff.requested', { workspaceId, conversationId, contactName: conv.contact.nome, motivo: HANDOFF_FAILURE_MOTIVO })
  await notifySpaceAttention(workspaceId, { contato: conv.contact.nome, motivo: HANDOFF_FAILURE_MOTIVO })
  log('ai', `passagem para humano após falhas (conversa ${conversationId})`)
}

/** Desligamento gracioso: devolve à fila os jobs deste processo que ainda estão executando (sem duplicar: ver sendKey). */
export async function releaseRunningAiJobs(): Promise<number> {
  const ids = Array.from(runningJobs)
  if (ids.length === 0) return 0
  for (const id of ids) releasedJobs.add(id)
  const r = await db.aiJob.updateMany({ where: { id: { in: ids }, status: AI_JOB.executando }, data: { status: AI_JOB.pendente, runAt: new Date() } })
  return r.count
}

export const runningAiJobCount = (): number => runningJobs.size

/**
 * Na subida do servidor (instância única): jobs "executando" reivindicados ANTES desta subida são de um processo que
 * morreu; voltam para a fila na hora (sem esperar o prazo de job preso). Reenvio duplicado é impedido pela sendKey.
 */
export async function recoverOrphanAiJobs(processStart: Date): Promise<number> {
  const r = await db.aiJob.updateMany({
    where: { status: AI_JOB.executando, runAt: { lt: processStart } },
    data: { status: AI_JOB.pendente, runAt: new Date() },
  })
  if (r.count > 0) log('ai', `${r.count} job(s) de um processo anterior devolvido(s) à fila`)
  return r.count
}

/** Reivindica e executa um job. Devolve false se outra instância o levou. */
async function runJob(job: AiJob): Promise<boolean> {
  // Uma execução por conversa: se outro job da mesma conversa está executando (outra instância, ou job
  // duplicado criado pela varredura), este espera o próximo tick em vez de gerar uma segunda resposta.
  const claim = await db.aiJob.updateMany({
    where: { id: job.id, status: AI_JOB.pendente, conversation: { aiJobs: { none: { status: AI_JOB.executando, id: { not: job.id } } } } },
    data: { status: AI_JOB.executando, attempts: { increment: 1 }, runAt: new Date() },
  })
  if (claim.count !== 1) return false
  runningJobs.add(job.id)
  const attempts = job.attempts + 1
  const { workspaceId, conversationId } = job

  let result: JobResult
  try {
    result = await execute(job)
  } catch (e) {
    result = { kind: 'retry', error: shortError(e) }
  }

  try {
    if (releasedJobs.has(job.id)) {
      // Devolvido à fila pelo desligamento: o resultado desta execução não vale (o job roda de novo no próximo processo).
      log('ai', `job ${job.id} devolvido à fila durante o desligamento; resultado descartado`)
    } else if (result.kind === 'done') {
      await finish(job, 'feito', result.note)
    } else if (result.kind === 'wait') {
      // Espera (mídia baixando, conferência de envio) não gasta tentativa, salvo envio que saiu sem confirmação.
      await db.aiJob.update({
        where: { id: job.id },
        data: { status: AI_JOB.pendente, attempts: result.consumeAttempt ? attempts : job.attempts, runAt: new Date(Date.now() + (result.delayMs ?? MEDIA_WAIT_MS)), error: keepManual(job.error, result.note) },
      })
      log('ai', `job ${job.id} aguardando (${result.note})`)
    } else if (attempts < MAX_ATTEMPTS) {
      const wait = RETRY_DELAYS_MS[attempts - 1] ?? 45_000
      await db.aiJob.update({
        where: { id: job.id },
        data: { status: AI_JOB.pendente, runAt: new Date(Date.now() + wait), error: keepManual(job.error, result.error) },
      })
      log('ai', `job ${job.id} falhou (tentativa ${attempts}/${MAX_ATTEMPTS}); nova tentativa em ${wait / 1000}s`)
    } else {
      await finish(job, 'erro', result.error)
      logError('ai', `job ${job.id} esgotou tentativas`, new Error(result.error))
      await escalateAfterFailure(job).catch((e) => logError('ai', 'passar para humano após falhas', e))
    }
  } finally {
    runningJobs.delete(job.id)
    releasedJobs.delete(job.id)
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

/**
 * Resgata jobs presos em "executando" (o processo caiu no meio): voltam para "pendente" (a tentativa já foi
 * contada na reivindicação) ou, se já esgotaram as tentativas, viram "erro". Também limpa o "digitando".
 * `runAt` é o critério correto: o AiJob não tem updatedAt e a reivindicação (runJob) grava runAt = agora, então
 * um job que acabou de começar nunca parece antigo.
 */
async function recoverStaleJobs(now: Date): Promise<void> {
  const stale = await db.aiJob.findMany({
    where: { status: AI_JOB.executando, runAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
    select: { id: true, attempts: true, workspaceId: true, conversationId: true, error: true },
  })
  for (const j of stale) {
    const exhausted = j.attempts >= MAX_ATTEMPTS
    const res = await db.aiJob.updateMany({
      where: { id: j.id, status: AI_JOB.executando },
      data: exhausted
        ? { status: AI_JOB.erro, error: 'Interrompido: o servidor reiniciou durante a execução' }
        : { status: AI_JOB.pendente, runAt: now, error: keepManual(j.error, 'Retomado após interrupção do servidor') },
    })
    if (res.count !== 1) continue
    log('ai', `job ${j.id} estava preso em executando; ${exhausted ? 'marcado como erro' : 'retomado'}`)
    try {
      const c = await db.conversation.findFirst({ where: { id: j.conversationId, workspaceId: j.workspaceId }, select: { typing: true } })
      if (c?.typing) await setTyping(j.workspaceId, j.conversationId, false)
    } catch (e) {
      logError('ai', 'falha ao limpar typing de job retomado', e)
    }
  }
}

/**
 * Executa os jobs de IA vencidos (até 4 conversas em paralelo). Devolve quantos rodaram.
 * Repete a busca enquanto aparecerem jobs novos (até ~30 s): sem isso, uma mensagem que vence enquanto um
 * lote lento roda esperaria o próximo tick inteiro.
 */
export async function runDueAiJobs(): Promise<number> {
  const startedAt = Date.now()
  await recoverStaleJobs(new Date(startedAt))
  const tried = new Set<string>()
  let ran = 0
  const concurrency = aiConcurrency()
  while (Date.now() - startedAt < RUN_BUDGET_MS && !engineStopping()) {
    const dueAll = await db.aiJob.findMany({
      where: { status: AI_JOB.pendente, runAt: { lte: new Date() }, ...(tried.size > 0 ? { id: { notIn: Array.from(tried) } } : {}) },
      orderBy: { runAt: 'asc' },
      take: 20,
    })
    // Uma conversa por vez: duplicatas ficam para a próxima volta (que as vê já respondidas).
    const seen = new Set<string>()
    const due = dueAll.filter((j) => !seen.has(j.conversationId) && seen.add(j.conversationId))
    if (due.length === 0) break
    for (const j of due) tried.add(j.id)
    for (let i = 0; i < due.length && !engineStopping(); i += concurrency) {
      const batch = due.slice(i, i + concurrency)
      // Cada job ocupa uma vaga da faixa da IA no semáforo do motor (dimensionado pelo connection_limit).
      const res = await Promise.allSettled(batch.map((j) => engineLimiter('ia').run(() => runJob(j))))
      for (const r of res) {
        if (r.status === 'fulfilled' && r.value) ran++
        else if (r.status === 'rejected') logError('ai', 'job falhou', r.reason)
      }
    }
  }
  return ran
}
