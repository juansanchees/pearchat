import { db } from '@/lib/db'
import { contactRef, ensureConversation, OutboundError, sendAndRecord } from './outbound'
import type { OutboundContent } from './outbound'
import { bumpUsage, firstName, getConnected, log, logError, shortError, spStartOfDay, spStartOfNextDay } from './util'

// Envio de disparos: no máximo UM destinatário por campanha por vez, com intervalo aleatório entre
// intervaloMin e intervaloMax segundos (Campaign.nextSendAt). Cada passo é reivindicado com UPDATE condicional.

const LOCK_MS = 60_000 // reserva do "slot" enquanto um envio está em andamento
const STALE_RECIPIENT_MS = 3 * 60_000
const REPLY_WINDOW_MS = 72 * 3_600_000

export const dailyLimit = (): number => {
  const n = Number(process.env.CAMPAIGN_DAILY_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
}

const randomIntervalMs = (min: number, max: number): number => {
  const lo = Math.max(1, Math.min(min, max))
  const hi = Math.max(lo, max)
  return (lo + Math.random() * (hi - lo)) * 1000
}

export function renderCampaignText(template: string, nome: string): string {
  const primeiro = firstName(nome)
  return template.replace(/\{primeiro_nome\}/gi, primeiro).replace(/\{nome\}/gi, nome.trim())
}

type CampaignRow = Awaited<ReturnType<typeof dueCampaigns>>[number]

function dueCampaigns(now: Date) {
  return db.campaign.findMany({
    where: {
      workspace: { disparosAtivos: true, whatsappSession: { is: { status: 'CONECTADO' } } },
      AND: [
        { OR: [{ status: { in: ['na_fila', 'enviando'] } }, { status: 'agendada', scheduledAt: { lte: now } }] },
        { OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
}

async function processCampaign(c: CampaignRow, now: Date): Promise<boolean> {
  const { workspaceId } = c
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
      where: { status: 'enviado', sentAt: { gte: spStartOfDay(now) }, campaign: { workspaceId } },
    })
    if (sentToday >= dailyLimit()) {
      await db.campaign.update({ where: { id: c.id }, data: { nextSendAt: spStartOfNextDay(now) } })
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
  if (contact.optOut) erro = 'Contato pediu para parar'
  else if (!contact.telefone && !contact.waUserId) erro = 'Contato sem telefone'

  if (!erro) {
    try {
      const conv = await ensureConversation(workspaceId, contact.id)
      const content: OutboundContent = template
        ? { kind: 'template', name: template.name, vars: [firstName(contact.nome)], body: template.body.replace(/\{\{1\}\}/g, firstName(contact.nome)) }
        : { kind: 'text', text: renderCampaignText(c.mensagem, contact.nome) }
      await sendAndRecord({ session, conversationId: conv.id, to: contactRef(contact), author: 'USER', content })
    } catch (e) {
      erro = e instanceof OutboundError ? e.message : shortError(e)
      logError('campaigns', `envio falhou (campanha ${c.id}, destinatário ${next.id})`, e)
    }
  }

  if (erro) {
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
      data: { nextSendAt: new Date(Date.now() + randomIntervalMs(c.intervaloMin, c.intervaloMax)) },
    })
  }
  return true
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

/** Roda um passo de todas as campanhas devidas. Devolve quantas mensagens saíram. */
export async function runDueCampaigns(): Promise<number> {
  const now = new Date()
  // Destinatários presos em "enviando" (processo caiu no meio do envio) voltam para a fila.
  await db.campaignRecipient.updateMany({
    where: { status: 'enviando', sentAt: { lt: new Date(now.getTime() - STALE_RECIPIENT_MS) } },
    data: { status: 'pendente', sentAt: null },
  })
  const due = await dueCampaigns(now)
  let sent = 0
  for (const c of due) {
    try {
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
      sentAt: { gte: new Date(at.getTime() - REPLY_WINDOW_MS) },
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
