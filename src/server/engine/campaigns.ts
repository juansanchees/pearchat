import { db } from '@/lib/db'
import { automationAllowed } from '@/server/billing/entitlements'
import { contactRef, ensureConversation, OutboundAlreadySentError, OutboundError, sendAndRecord } from './outbound'
import type { OutboundContent } from './outbound'
import { nextHourTz, normTz, startOfDayTz, startOfNextDayTz } from '@/lib/timezone'
import { bumpUsage, getConnected, log, logError, personalize, shortError, silenceEnd, templateFirstName } from './util'

// Envio de disparos: no máximo UM destinatário por campanha por vez, com intervalo aleatório entre
// intervaloMin e intervaloMax segundos (Campaign.nextSendAt). Cada passo é reivindicado com UPDATE condicional.

const LOCK_MS = 60_000 // reserva do "slot" enquanto um envio está em andamento
const STALE_RECIPIENT_MS = 3 * 60_000
const REPLY_WINDOW_MS = 72 * 3_600_000
const RESUME_HOUR = 8 // o limite diário retoma no dia seguinte às 8h (fuso do espaço), nunca de madrugada

export const dailyLimit = (): number => {
  const n = Number(process.env.CAMPAIGN_DAILY_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
}

const randomIntervalMs = (min: number, max: number): number => {
  const lo = Math.max(1, Math.min(min, max))
  const hi = Math.max(lo, max)
  return (lo + Math.random() * (hi - lo)) * 1000
}

export function renderCampaignText(template: string, nome: string, ids: { telefone?: string | null; waUserId?: string | null } = {}): string {
  return personalize(template, nome, ids)
}

type CampaignRow = Awaited<ReturnType<typeof dueCampaigns>>[number]

function dueCampaigns(now: Date) {
  return db.campaign.findMany({
    where: {
      workspace: { disparosAtivos: true, arquivadoEm: null, whatsappSession: { is: { status: 'CONECTADO' } } },
      AND: [
        { OR: [{ status: { in: ['na_fila', 'enviando'] } }, { status: 'agendada', scheduledAt: { lte: now } }] },
        { OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { workspace: { select: { disparosSilencioAtivo: true, disparosSilencioInicio: true, disparosSilencioFim: true, timezone: true } } },
  })
}

async function processCampaign(c: CampaignRow, now: Date): Promise<boolean> {
  const { workspaceId } = c
  // Silêncio, "hoje" do limite diário e a hora de retomada seguem o relógio do espaço (Workspace.timezone).
  const tz = normTz(c.workspace.timezone)
  // Horário de silêncio: não envia; o próximo envio fica para o fim da janela (campanha agendada para dentro
  // dela também começa só no fim).
  const fimSilencio = silenceEnd(now, c.workspace)
  if (fimSilencio) {
    await db.campaign.updateMany({
      where: { id: c.id, OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }] },
      data: { nextSendAt: fimSilencio },
    })
    return false
  }
  // Reivindica o slot: só uma instância/tick passa daqui.
  const claim = await db.campaign.updateMany({
    where: {
      id: c.id,
      status: c.status,
      OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }],
    },
    data: { nextSendAt: new Date(now.getTime() + LOCK_MS) },
  })
  if (claim.count !== 1) return false

  const session = await getConnected(workspaceId)
  if (!session) {
    await db.campaign.update({ where: { id: c.id }, data: { nextSendAt: null } })
    return false
  }

  // Conexão rápida: limite diário de segurança por workspace.
  if (!session.official) {
    const sentToday = await db.campaignRecipient.count({
      where: { status: 'enviado', sentAt: { gte: startOfDayTz(now, tz) }, campaign: { workspaceId } },
    })
    if (sentToday >= dailyLimit()) {
      await db.campaign.update({ where: { id: c.id }, data: { nextSendAt: nextHourTz(startOfNextDayTz(now, tz), RESUME_HOUR, tz) } })
      log('campaigns', `campanha ${c.id}: limite diário atingido; retoma amanhã`)
      return false
    }
  }

  // Oficial: precisa de modelo APROVADO.
  let template: { name: string; body: string } | null = null
  if (session.official) {
    const t = c.templateId ? await db.template.findFirst({ where: { id: c.templateId, workspaceId } }) : null
    if (!t || t.status !== 'APROVADO') {
      await db.campaign.update({ where: { id: c.id }, data: { status: 'pausada', pausedAt: now, nextSendAt: null } })
      log('campaigns', `campanha ${c.id} pausada: modelo ausente ou não aprovado`)
      return false
    }
    template = { name: t.name, body: t.body }
  }

  // Próximo destinatário pendente, reivindicado antes de enviar.
  const next = await db.campaignRecipient.findFirst({ where: { campaignId: c.id, status: 'pendente' }, orderBy: { id: 'asc' }, include: { contact: true } })
  if (!next) {
    await finishIfDone(c.id)
    return false
  }
  const rc = await db.campaignRecipient.updateMany({ where: { id: next.id, status: 'pendente' }, data: { status: 'enviando', sentAt: now } })
  if (rc.count !== 1) {
    await db.campaign.update({ where: { id: c.id }, data: { nextSendAt: null } })
    return false
  }
  if (c.status !== 'enviando') await db.campaign.updateMany({ where: { id: c.id, status: { in: ['na_fila', 'agendada'] } }, data: { status: 'enviando' } })

  const contact = next.contact
  let erro: string | null = null
  // Quem saiu da lista (opt-out) ou não tem como receber é "pulado": sai do total, para o progresso fechar.
  let pulado: string | null = null
  if (contact.optOut) pulado = 'Contato pediu para parar'
  else if (!contact.telefone && !contact.waUserId) pulado = 'Contato sem telefone'

  if (!pulado) {
    try {
      const conv = await ensureConversation(workspaceId, contact.id)
      const ids = { telefone: contact.telefone, waUserId: contact.waUserId }
      let content: OutboundContent
      if (template) {
        const primeiro = templateFirstName(contact.nome, ids)
        content = { kind: 'template', name: template.name, vars: [primeiro], body: template.body.replace(/\{\{1\}\}/g, () => primeiro) }
      } else {
        const text = renderCampaignText(c.mensagem, contact.nome, ids)
        if (!text.trim()) throw new OutboundError('Mensagem vazia')
        content = { kind: 'text', text }
      }
      // Um destinatário recebe no máximo uma mensagem por campanha (retomada após queda não repete). Envio sem
      // confirmação conta como enviado: nunca reenvia às cegas.
      await sendAndRecord({ session, conversationId: conv.id, to: contactRef(contact), author: 'USER', content, sendKey: `cp:${next.id}` })
    } catch (e) {
      if (!(e instanceof OutboundAlreadySentError)) {
        erro = e instanceof OutboundError ? e.message : shortError(e)
        logError('campaigns', `envio falhou (campanha ${c.id}, destinatário ${next.id})`, e)
      }
    }
  }

  if (pulado) {
    await db.campaignRecipient.update({ where: { id: next.id }, data: { status: 'pulado', error: pulado, sentAt: null } })
    await db.campaign.update({ where: { id: c.id }, data: { total: { decrement: 1 } } })
  } else if (erro) {
    await db.campaignRecipient.update({ where: { id: next.id }, data: { status: 'erro', error: erro.slice(0, 200), sentAt: null } })
  } else {
    await db.campaignRecipient.update({ where: { id: next.id }, data: { status: 'enviado', sentAt: new Date(), error: null } })
    await db.campaign.update({ where: { id: c.id }, data: { enviadas: { increment: 1 } } })
    await bumpUsage(workspaceId, { disparos: 1 })
  }

  const done = await finishIfDone(c.id)
  if (!done) {
    await db.campaign.updateMany({
      where: { id: c.id, status: 'enviando' },
      // Pulado (opt-out/sem telefone) não enviou nada: não precisa esperar o intervalo.
      data: { nextSendAt: pulado ? null : new Date(Date.now() + randomIntervalMs(c.intervaloMin, c.intervaloMax)) },
    })
  }
  return !pulado && !erro
}

/** Conclui a campanha quando não resta destinatário pendente. Devolve true se concluiu. */
async function finishIfDone(campaignId: string): Promise<boolean> {
  const left = await db.campaignRecipient.count({ where: { campaignId, status: { in: ['pendente', 'enviando'] } } })
  if (left > 0) return false
  const r = await db.campaign.updateMany({
    where: { id: campaignId, status: { in: ['na_fila', 'agendada', 'enviando'] } },
    data: { status: 'concluida', nextSendAt: null },
  })
  if (r.count === 1) log('campaigns', `campanha ${campaignId} concluída`)
  return true
}

/**
 * Destinatários presos em "enviando" (processo caiu no meio do envio). Se a mensagem já foi gravada depois
 * da reivindicação, o envio aconteceu: vira "enviado" (nunca reenvia); senão volta para a fila.
 */
async function rescueStaleRecipients(now: Date): Promise<void> {
  const stale = await db.campaignRecipient.findMany({
    where: { status: 'enviando', sentAt: { lt: new Date(now.getTime() - STALE_RECIPIENT_MS) } },
    select: { id: true, campaignId: true, contactId: true, sentAt: true, campaign: { select: { workspaceId: true } } },
    take: 100,
  })
  for (const r of stale) {
    const claimedAt = r.sentAt ?? new Date(0)
    // O envio deste destinatário (sendKey) ou, para envios antigos sem chave, qualquer OUT depois da reivindicação.
    const went = await db.message.findFirst({
      where: {
        conversation: { contactId: r.contactId },
        OR: [{ sendKey: `cp:${r.id}`, NOT: { status: 'FALHOU' } }, { direction: 'OUT', sendKey: null, createdAt: { gte: claimedAt } }],
      },
      select: { id: true },
    })
    const upd = await db.campaignRecipient.updateMany({
      where: { id: r.id, status: 'enviando' },
      data: went ? { status: 'enviado', error: null } : { status: 'pendente', sentAt: null },
    })
    if (went && upd.count === 1) {
      await db.campaign.update({ where: { id: r.campaignId }, data: { enviadas: { increment: 1 } } })
      await bumpUsage(r.campaign.workspaceId, { disparos: 1 })
    }
  }
}

/** Roda um passo de todas as campanhas devidas. Devolve quantas mensagens saíram. */
export async function runDueCampaigns(): Promise<number> {
  const now = new Date()
  await rescueStaleRecipients(now)
  const due = await dueCampaigns(now)
  let sent = 0
  for (const c of due) {
    try {
      if (!(await automationAllowed(c.workspaceId))) continue // modo restrito: disparos pausados (a fila é mantida)
      if (await processCampaign(c, now)) sent++
    } catch (e) {
      logError('campaigns', `campanha ${c.id} falhou`, e)
    }
  }
  return sent
}

/**
 * Chamado pelo ingest quando o contato escreve: se recebeu disparo nas últimas 72 h e a resposta ainda
 * não foi contada, incrementa Campaign.respostas (uma vez por destinatário).
 */
export async function registerCampaignReplies(workspaceId: string, contactId: string, at: Date): Promise<number> {
  const rows = await db.campaignRecipient.findMany({
    where: {
      contactId,
      status: 'enviado',
      repliedAt: null,
      // Resposta = mensagem DEPOIS do envio e até 72 h dele (com folga de 5 min para relógios diferentes).
      sentAt: { gte: new Date(at.getTime() - REPLY_WINDOW_MS), lte: new Date(at.getTime() + 5 * 60_000) },
      campaign: { workspaceId },
    },
    select: { id: true, campaignId: true },
  })
  let counted = 0
  for (const r of rows) {
    const claim = await db.campaignRecipient.updateMany({ where: { id: r.id, repliedAt: null }, data: { repliedAt: at } })
    if (claim.count === 1) {
      await db.campaign.update({ where: { id: r.campaignId }, data: { respostas: { increment: 1 } } })
      counted++
    }
  }
  return counted
}
