import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { automationAllowed } from '@/server/billing/entitlements'
import { canSendFreeformTo } from './freeform'
import { contactRef, ensureConversation, OutboundError, sendAndRecord } from './outbound'
import type { OutboundContent } from './outbound'
import { getConnected, log, logError, shortError, spParts, templateFirstName } from './util'

// Lembretes da agenda: um por evento e tipo (EventReminder @@unique[eventId, kind]).
// Para cada evento só sai o lembrete MAIS PRÓXIMO do horário entre os que já venceram; os anteriores
// (ex.: o de 24 h de um evento criado há 1 h) ficam registrados como "pulado".

const OFFSETS_MIN: Record<string, number> = { '24h': 24 * 60, '2h': 120, '30min': 30 }
export const REMINDER_TEMPLATE = 'lembrete_agendamento'

/**
 * Qual lembrete pede confirmação ("Responda 1 para confirmar ou 2 para remarcar"): o de 24 h; se não há o de 24 h, o de 2 h.
 * (Só o de 30 min nunca pede.) Só no provedor não oficial: no oficial o lembrete usa o modelo aprovado e fica como era.
 */
export function confirmationKind(kinds: string[]): string | null {
  return kinds.includes('24h') ? '24h' : kinds.includes('2h') ? '2h' : null
}

export function diaLabel(inicio: Date, now: Date): string {
  const a = spParts(inicio)
  const b = spParts(now)
  if (a.ymd === b.ymd) return 'hoje'
  const amanha = spParts(new Date(now.getTime() + 24 * 3_600_000)).ymd
  if (a.ymd === amanha) return 'amanhã'
  const [, mm, dd] = a.ymd.split('-')
  return `${dd}/${mm}`
}

export const horaLabel = (d: Date): string => {
  const p = spParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Cria o registro (o "claim"). Devolve false se já existia. */
async function claim(eventId: string, kind: string, result: string | null): Promise<boolean> {
  try {
    await db.eventReminder.create({ data: { eventId, kind, result } })
    return true
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false
    throw e
  }
}

/** Envia os lembretes devidos. Devolve quantos foram enviados. */
export async function runDueReminders(): Promise<number> {
  const now = new Date()
  const conns = await db.calendarConnection.findMany({
    where: { lembretes: { isEmpty: false }, workspace: { arquivadoEm: null, whatsappSession: { is: { status: 'CONECTADO' } } } },
    select: { workspaceId: true, lembretes: true, pedirConfirmacao: true },
  })
  let sent = 0
  for (const conn of conns) {
    try {
      sent += await remindWorkspace(conn, now)
    } catch (e) {
      logError('reminders', `workspace ${conn.workspaceId} falhou`, e)
    }
  }
  if (sent > 0) log('reminders', `${sent} lembrete(s) enviado(s)`)
  return sent
}

async function remindWorkspace(conn: { workspaceId: string; lembretes: string[]; pedirConfirmacao: boolean }, now: Date): Promise<number> {
  let sent = 0
  if (!(await automationAllowed(conn.workspaceId))) return 0 // modo restrito: sem lembretes automáticos
  {
    const kinds = conn.lembretes.filter((k) => k in OFFSETS_MIN).sort((a, b) => (OFFSETS_MIN[a] ?? 0) - (OFFSETS_MIN[b] ?? 0))
    if (kinds.length === 0) return 0
    const maxOffset = Math.max(...kinds.map((k) => OFFSETS_MIN[k] ?? 0))
    const events = await db.event.findMany({
      where: {
        workspaceId: conn.workspaceId,
        status: 'ativo',
        inicio: { gt: now, lte: new Date(now.getTime() + maxOffset * 60_000) },
        contactId: { not: null },
      },
      include: { contact: true, reminders: { select: { kind: true } }, serviceType: { select: { nome: true } } },
      orderBy: { inicio: 'asc' },
      take: 200,
    })
    for (const ev of events) {
      try {
        const contact = ev.contact
        if (!contact) continue
        const remainingMin = (ev.inicio.getTime() - now.getTime()) / 60_000
        const done = new Set(ev.reminders.map((r) => r.kind))
        // Vencidos = os que já passaram do horário de disparo (faltam <= offset). `kinds` está do menor para o maior.
        const due = kinds.filter((k) => remainingMin <= (OFFSETS_MIN[k] ?? 0))
        const target = due[0]
        if (!target) continue
        if (done.has(target)) continue
        for (const k of due.slice(1)) {
          if (!done.has(k)) await claim(ev.id, k, 'pulado: janela já passou')
        }
        // Quem não pode receber é registrado com o motivo, não ignorado em silêncio.
        const skip = !contact.telefone && !contact.waUserId ? 'pulado: contato sem telefone' : contact.optOut ? 'pulado: contato pediu para parar' : null
        if (!(await claim(ev.id, target, skip))) continue
        if (skip) continue

        // Nome do tipo de atendimento atual (o texto "tipo" do evento guarda o nome da época do agendamento).
        const ask = conn.pedirConfirmacao && ev.confirmacao === 'pendente' && target === confirmationKind(kinds)
        const { result, asked } = await sendReminder(conn.workspaceId, { id: ev.id, inicio: ev.inicio, tipo: ev.serviceType?.nome ?? ev.tipo }, contact, now, ask)
        await db.eventReminder.updateMany({ where: { eventId: ev.id, kind: target }, data: { result, pediuConfirmacao: asked && result === 'enviado' } })
        if (result === 'enviado') sent++
      } catch (e) {
        logError('reminders', `evento ${ev.id} falhou`, e)
      }
    }
  }
  return sent
}

async function sendReminder(
  workspaceId: string,
  ev: { id: string; inicio: Date; tipo: string },
  contact: { id: string; nome: string; waUserId: string | null; telefone: string | null },
  now: Date,
  ask: boolean,
): Promise<{ result: string; asked: boolean }> {
  const session = await getConnected(workspaceId)
  if (!session) return { result: 'pulado: WhatsApp desconectado', asked: false }
  const dia = diaLabel(ev.inicio, now)
  const hora = horaLabel(ev.inicio)
  const to = contactRef(contact)
  let content: OutboundContent
  let freeform = false
  let asked = false

  if (session.official) {
    const t = await db.template.findFirst({ where: { workspaceId, name: REMINDER_TEMPLATE } })
    if (t && t.status === 'APROVADO') {
      const vars = [templateFirstName(contact.nome, contact), ev.tipo, dia, hora]
      const n = Math.max(0, ...Array.from(t.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
      const used = vars.slice(0, n)
      const body = t.body.replace(/\{\{(\d+)\}\}/g, (_m, i: string) => used[Number(i) - 1] ?? '')
      content = { kind: 'template', name: t.name, vars: used, body }
    } else if (await canSendFreeformTo(session, to)) {
      freeform = true
      content = { kind: 'text', text: `Lembrete: seu horário (${ev.tipo}) é ${dia} às ${hora}.` }
    } else {
      return { result: 'pulado: modelo lembrete_agendamento ausente ou não aprovado', asked: false }
    }
  } else if (ask) {
    asked = true
    content = { kind: 'text', text: `Lembrete: seu horário de ${ev.tipo} é ${dia}, às ${hora}. Responda 1 para confirmar ou 2 para remarcar.` }
  } else {
    content = { kind: 'text', text: `Lembrete: seu horário (${ev.tipo}) é ${dia} às ${hora}.` }
  }

  try {
    const conv = await ensureConversation(workspaceId, contact.id)
    await sendAndRecord({ session, conversationId: conv.id, to, author: 'IA', content, countAtendimento: freeform })
    return { result: 'enviado', asked }
  } catch (e) {
    return { result: `erro: ${e instanceof OutboundError ? e.message : shortError(e)}`.slice(0, 200), asked: false }
  }
}
