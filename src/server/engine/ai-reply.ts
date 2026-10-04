import type { AiAgent, AiJob, Contact, Conversation, Message } from '@prisma/client'
import { db } from '@/lib/db'
import { generateReply, LlmError } from '@/server/agent/llm'
import type { ChatMessage } from '@/server/agent/llm'
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
import { HANDOFF_LIMIT_NOTE, HANDOFF_MODEL_NOTE, handoffRuleNote } from './handoff-reasons'
import { contactRef, OutboundError, sendAndRecord } from './outbound'
import { cancelPendingFollowUps } from './followup'
import { agentMayReplyAt, detectHandoffRule, formatAgora, genericHandoffMessage, isStopRequest, ungroundedMoney } from './rules'
import { bumpUsage, displayName, engineDisabled, getConnected, log, logError, shortError } from './util'

// Resposta da IA às conversas. Fluxo: ingestInboundMessage -> scheduleAiReply (debounce de 4 s) ->
// o agendador executa runDueAiJobs. Cada conjunto de mensagens seguidas do cliente gera UMA resposta.

export const AI_DEBOUNCE_MS = 4_000
const SWEEP_SPACING_MS = 1_200
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [15_000, 45_000]
const HISTORY_LIMIT = 30
const MAX_MESSAGE_CHARS = 1500 // trava o custo se o cliente colar um texto enorme
const STALE_RUNNING_MS = 2 * 60_000 // o modelo tem timeout de 45 s: 2 min sem terminar = processo caiu
const SWEEP_LOOKBACK_MS = 24 * 3_600_000 // janela de 24 h do WhatsApp
const CONCURRENCY = 4
// Espera por transcrição/download de mídia antes de responder: até 3 vezes, 7 s cada (~20 s no total).
const MEDIA_WAIT_MS = 7_000
const MEDIA_WAIT_MAX = 3
const MEDIA_WAIT_NOTE = 'aguardando-midia:'
const VISION_MAX_BYTES = 4 * 1024 * 1024
const VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const RUN_BUDGET_MS = 30_000 // tempo máximo de uma passada do runDueAiJobs

const LIMIT_NOTICE = 'Vou chamar alguém da nossa equipe para continuar seu atendimento.'
const NOT_FAILED_OUT = { NOT: { direction: 'OUT' as const, status: 'FALHOU' as const } }

// Notas de jobs cancelados que não significam "cliente atendido" (ver enqueuePendingForWorkspace).
const RETRY_CANCEL_NOTES = ['cancelado: WhatsApp desconectado', 'cancelado: IA desligada']

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

  // Candidatas: última mensagem é do cliente, não importada, com mais de 6 s (o ingest cuida das recém-chegadas)
  // e que chegou numa hora em que a IA podia responder (senão é de atendimento humano).
  const candidates = convs.filter((c) => {
    const last = c.messages[0]
    return (
      !!last &&
      last.direction === 'IN' &&
      !last.imported &&
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
  for (const a of agents) total += await enqueuePendingForWorkspace(a.workspaceId)
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

type JobResult = { kind: 'done'; note?: string } | { kind: 'retry'; error: string } | { kind: 'wait'; note: string }

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
  const el = await loadAgentFor(workspaceId, new Date())
  if (!el.ok) return { kind: 'done', note: `cancelado: ${el.reason}` }
  const session = await getConnected(workspaceId)
  if (!session) return { kind: 'done', note: 'cancelado: WhatsApp desconectado' }

  // Envios que falharam (OUT/FALHOU) não contam: senão a nova tentativa acharia que a conversa já foi respondida.
  const recent = await db.message.findMany({ where: { conversationId, ...NOT_FAILED_OUT }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT })
  const last = recent[0]
  if (!last || last.direction !== 'IN') return { kind: 'done', note: 'nada a responder (já respondida)' }
  // Histórico importado do WhatsApp nunca gera resposta.
  if (last.imported) return { kind: 'done', note: 'nada a responder (mensagem importada)' }
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
    const done = Number(new RegExp(`^${MEDIA_WAIT_NOTE}(\\d+)`).exec(job.error ?? '')?.[1] ?? 0)
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

  // Limite de respostas de IA do plano.
  const quota = await getAiQuota(workspaceId)
  if (quota.limite !== null && quota.usadas >= quota.limite) {
    // Avisa o cliente UMA vez (sem falar de plano/limite) antes de passar para a equipe.
    const jaAvisou = await db.message.findFirst({ where: { conversationId, author: 'IA', body: LIMIT_NOTICE }, select: { id: true } })
    await handoff({ session, conv, motivo: 'limite do plano', message: jaAvisou ? null : LIMIT_NOTICE })
    return { kind: 'done', note: HANDOFF_LIMIT_NOTE }
  }

  // Regras de passagem por palavra-chave: antes de chamar o modelo.
  const hit = detectHandoffRule(customerText, agent.handoffRules)
  if (hit) {
    await handoff({ session, conv, motivo: hit.motivo, message: hit.mensagem(responsavel) })
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
      texto = ungroundedMoney(r2.texto, corpus).length > 0 ? 'Esse valor eu preciso confirmar com a equipe e já te retorno, tá?' : r2.texto
    }
  } catch (e) {
    await saveToolLog(job, runner)
    return { kind: 'retry', error: e instanceof LlmError ? e.message : shortError(e) }
  }
  await saveToolLog(job, runner)

  // Revalida: a conversa pode ter virado HUMANO, a IA ter sido desligada, ou chegado mais mensagens.
  const [conv2, el2, newest] = await Promise.all([
    db.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { mode: true } }),
    loadAgentFor(workspaceId, new Date()),
    db.message.findFirst({ where: { conversationId, ...NOT_FAILED_OUT }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
  ])
  if (!conv2 || conv2.mode === 'HUMANO') return { kind: 'done', note: 'cancelado: virou modo humano durante a geração' }
  if (!el2.ok) return { kind: 'done', note: `cancelado: ${el2.reason}` }
  if (newest?.id !== last.id) return { kind: 'done', note: 'superado: chegou mensagem nova durante a geração' }

  if (texto.includes(HANDOFF_MARKER)) {
    await handoff({ session, conv, motivo: 'regra de passagem (decisão da IA)', message: genericHandoffMessage(responsavel) })
    return { kind: 'done', note: HANDOFF_MODEL_NOTE }
  }

  try {
    const sent = await sendAndRecord({
      session,
      conversationId,
      to,
      author: 'IA',
      content: { kind: 'text', text: stripRepeatedGreeting(texto, history) },
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

/**
 * Rede de segurança: se a conversa já tem resposta nossa, o modelo às vezes ainda abre com "Oi!"/"Olá!".
 * Tira só a saudação solta do começo ("Oi, Maria!" com nome fica).
 */
export function stripRepeatedGreeting(texto: string, history: ChatMessage[]): string {
  if (!history.some((m) => m.role === 'assistant')) return texto
  const rest = texto.replace(/^\s*(?:oi|ol[aá])\s*[!.]+\s*/i, '')
  if (rest === texto || rest.trim().length < 3) return texto
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function tomFromDb(tom: string): 'Amigável' | 'Profissional' | 'Direto' {
  return tom === 'profissional' ? 'Profissional' : tom === 'direto' ? 'Direto' : 'Amigável'
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
    } else if (result.kind === 'wait') {
      // Espera por mídia não gasta tentativa: devolve a contagem e reagenda.
      await db.aiJob.update({ where: { id: job.id }, data: { status: AI_JOB.pendente, attempts: job.attempts, runAt: new Date(Date.now() + MEDIA_WAIT_MS), error: result.note } })
      log('ai', `job ${job.id} aguardando mídia (${result.note})`)
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

/**
 * Resgata jobs presos em "executando" (o processo caiu no meio): voltam para "pendente" (a tentativa já foi
 * contada na reivindicação) ou, se já esgotaram as tentativas, viram "erro". Também limpa o "digitando".
 * `runAt` é o critério correto: o AiJob não tem updatedAt e a reivindicação (runJob) grava runAt = agora, então
 * um job que acabou de começar nunca parece antigo.
 */
async function recoverStaleJobs(now: Date): Promise<void> {
  const stale = await db.aiJob.findMany({
    where: { status: AI_JOB.executando, runAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
    select: { id: true, attempts: true, workspaceId: true, conversationId: true },
  })
  for (const j of stale) {
    const exhausted = j.attempts >= MAX_ATTEMPTS
    const res = await db.aiJob.updateMany({
      where: { id: j.id, status: AI_JOB.executando },
      data: exhausted
        ? { status: AI_JOB.erro, error: 'Interrompido: o servidor reiniciou durante a execução' }
        : { status: AI_JOB.pendente, runAt: now, error: 'Retomado após interrupção do servidor' },
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
  while (Date.now() - startedAt < RUN_BUDGET_MS) {
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
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      const batch = due.slice(i, i + CONCURRENCY)
      const res = await Promise.allSettled(batch.map((j) => runJob(j)))
      for (const r of res) {
        if (r.status === 'fulfilled' && r.value) ran++
        else if (r.status === 'rejected') logError('ai', 'job falhou', r.reason)
      }
    }
  }
  return ran
}
