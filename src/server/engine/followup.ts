import { db } from '@/lib/db'
import { FU_MENSAGENS_PADRAO } from '@/server/followup/service'
import { canSendFreeformTo } from './freeform'
import { contactRef, OutboundError, sendAndRecord } from './outbound'
import type { OutboundContent } from './outbound'
import { firstName, getConnected, log, logError, shortError, spNextHour, spParts } from './util'

// Follow-up automático. Planejamento (cria FollowUpJob) + execução (envia) + cancelamento (ingest).
//
// Pendência: a condição de parada "Pedido fechado" não tem sinal no modelo de dados (não há pedido
// ligado à conversa). Quando existir (ex.: Contact.pedidos incrementado), basta cancelar aqui.

const STATUS = { pendente: 'pendente', executando: 'executando', enviado: 'enviado', erro: 'erro', cancelado: 'cancelado' } as const
const QUIET_START = 21 // não envia entre 21h e 8h (São Paulo)
const QUIET_END = 8
const LOOKBACK_MS = 7 * 24 * 3_600_000 // não retoma conversas paradas há mais de 7 dias
const STALE_MS = 3 * 60_000
export const FOLLOWUP_TEMPLATE = 'retomada_conversa'

const inQuietHours = (d: Date): boolean => {
  // Só para testes em modo demo: ignora a janela de 21h às 8h.
  if (process.env.WA_MOCK === 'true' && process.env.ENGINE_FOLLOWUP_ANYTIME === 'true') return false
  const h = spParts(d).hour
  return h >= QUIET_START || h < QUIET_END
}

/** Se `d` cai entre 21h e 8h, devolve as 8h seguintes. */
export const adjustToSendWindow = (d: Date): Date => (inQuietHours(d) ? spNextHour(d, QUIET_END) : d)

/** Cancela os follow-ups pendentes da conversa (ex.: "Cliente respondeu"). */
export async function cancelPendingFollowUps(conversationId: string, motivo: string): Promise<number> {
  const r = await db.followUpJob.updateMany({
    where: { conversationId, status: { in: [STATUS.pendente, STATUS.executando] } },
    data: { status: STATUS.cancelado, error: motivo },
  })
  return r.count
}

/** (a) Cria os jobs devidos. Devolve quantos criou. */
export async function planFollowUps(): Promise<number> {
  const now = new Date()
  const rules = await db.followUpRule.findMany({
    where: { enabled: true, workspace: { whatsappSession: { is: { status: 'CONECTADO' } } } },
  })
  let created = 0
  for (const rule of rules) {
    const { workspaceId } = rule
    const cutoff = new Date(now.getTime() - rule.esperaHoras * 3_600_000)
    const convs = await db.conversation.findMany({
      where: {
        workspaceId,
        lastMessageAt: { lt: cutoff, gte: new Date(now.getTime() - LOOKBACK_MS) },
        contact: { optOut: false, events: { none: { inicio: { gt: now } } } },
        jobs: { none: { status: { in: [STATUS.pendente, STATUS.executando] } } },
        // O cliente já conversou conosco alguma vez (não faz follow-up de disparo frio).
        messages: { some: { direction: 'IN' } },
      },
      orderBy: { lastMessageAt: 'asc' },
      take: 100,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    for (const c of convs) {
      const last = c.messages[0]
      if (!last || last.direction !== 'OUT' || last.createdAt >= cutoff) continue
      // Histórico importado do WhatsApp: não planeja follow-up sobre conversas anteriores à conexão.
      if (last.imported) continue
      if (last.status === 'FALHOU') continue
      // Conversa entregue a uma pessoa pela IA (passagem): quem tem que responder é a pessoa.
      if (c.mode === 'HUMANO' && last.author === 'IA') continue

      const lastIn = await db.message.findFirst({ where: { conversationId: c.id, direction: 'IN' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      const done = await db.followUpJob.count({
        where: {
          conversationId: c.id,
          status: { in: [STATUS.enviado, STATUS.erro] },
          ...(lastIn ? { createdAt: { gte: lastIn.createdAt } } : {}),
        },
      })
      if (done >= rule.tentativas) continue
      await db.followUpJob.create({
        data: { conversationId: c.id, tentativa: done + 1, runAt: adjustToSendWindow(now), status: STATUS.pendente },
      })
      created++
    }
  }
  if (created > 0) log('followup', `${created} job(s) criado(s)`)
  return created
}

type Job = { id: string; conversationId: string; tentativa: number }

async function finishJob(id: string, status: 'enviado' | 'erro' | 'cancelado', error?: string): Promise<void> {
  await db.followUpJob.update({ where: { id }, data: { status, error: error ?? null } })
}

async function executeJob(job: Job): Promise<void> {
  const conv = await db.conversation.findUnique({
    where: { id: job.conversationId },
    include: { contact: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!conv) return finishJob(job.id, 'cancelado', 'Conversa não existe')
  const { workspaceId } = conv
  const rule = await db.followUpRule.findUnique({ where: { workspaceId } })
  if (!rule?.enabled) return finishJob(job.id, 'cancelado', 'Follow-up desligado')
  if (conv.contact.optOut) return finishJob(job.id, 'cancelado', 'Cliente pediu para parar')
  const last = conv.messages[0]
  if (!last || last.direction !== 'OUT') return finishJob(job.id, 'cancelado', 'Cliente respondeu')
  const session = await getConnected(workspaceId)
  if (!session) {
    // Sem conexão agora: devolve para a fila e tenta mais tarde.
    await db.followUpJob.update({ where: { id: job.id }, data: { status: STATUS.pendente, runAt: new Date(Date.now() + 5 * 60_000) } })
    return
  }

  const raw = rule.mensagens[job.tentativa - 1]?.trim() || FU_MENSAGENS_PADRAO[job.tentativa - 1] || FU_MENSAGENS_PADRAO[0] || ''
  const nome = conv.contact.nome
  const text = raw.replace(/\{primeiro_nome\}/gi, firstName(nome)).replace(/\{nome\}/gi, nome.trim())
  const to = contactRef(conv.contact)

  let content: OutboundContent
  let freeform = true
  if (await canSendFreeformTo(session, to)) {
    content = { kind: 'text', text }
  } else {
    freeform = false
    const t = await db.template.findFirst({ where: { workspaceId, name: FOLLOWUP_TEMPLATE } })
    if (!t || t.status !== 'APROVADO') {
      return finishJob(job.id, 'erro', 'Fora da janela de 24h e sem o modelo retomada_conversa aprovado')
    }
    content = { kind: 'template', name: t.name, vars: [firstName(nome)], body: t.body.replace(/\{\{1\}\}/g, firstName(nome)) }
  }

  try {
    await sendAndRecord({ session, conversationId: conv.id, to, author: 'IA', content, countAtendimento: freeform })
    await finishJob(job.id, 'enviado')
  } catch (e) {
    await finishJob(job.id, 'erro', e instanceof OutboundError ? e.message : shortError(e))
  }
}

/** (b) Executa os jobs vencidos. Devolve quantos foram enviados. */
export async function runDueFollowUps(): Promise<number> {
  const now = new Date()
  await db.followUpJob.updateMany({
    where: { status: STATUS.executando, updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
    data: { status: STATUS.pendente },
  })
  const due = await db.followUpJob.findMany({
    where: { status: STATUS.pendente, runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: 20,
    select: { id: true, conversationId: true, tentativa: true },
  })
  let sent = 0
  for (const job of due) {
    try {
      // Janela de envio: reagenda para 8h em vez de enviar de madrugada.
      if (inQuietHours(now)) {
        await db.followUpJob.updateMany({ where: { id: job.id, status: STATUS.pendente }, data: { runAt: spNextHour(now, QUIET_END) } })
        continue
      }
      const claim = await db.followUpJob.updateMany({ where: { id: job.id, status: STATUS.pendente }, data: { status: STATUS.executando } })
      if (claim.count !== 1) continue
      await executeJob(job)
      sent++
    } catch (e) {
      logError('followup', `job ${job.id} falhou`, e)
      await db.followUpJob.updateMany({ where: { id: job.id, status: STATUS.executando }, data: { status: STATUS.erro, error: shortError(e) } })
    }
  }
  return sent
}
