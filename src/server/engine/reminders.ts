import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { canSendFreeformTo } from './freeform'
import { contactRef, ensureConversation, OutboundError, sendAndRecord } from './outbound'
import type { OutboundContent } from './outbound'
import { firstName, getConnected, log, logError, shortError, spParts } from './util'

// Lembretes da agenda: um por evento e tipo (EventReminder @@unique[eventId, kind]).
// Para cada evento só sai o lembrete MAIS PRÓXIMO do horário entre os que já venceram; os anteriores
// (ex.: o de 24 h de um evento criado há 1 h) ficam registrados como "pulado".

const OFFSETS_MIN: Record<string, number> = { '24h': 24 * 60, '2h': 120, '30min': 30 }
export const REMINDER_TEMPLATE = 'lembrete_agendamento'

function diaLabel(inicio: Date, now: Date): string {
  const a = spParts(inicio)
  const b = spParts(now)
  if (a.ymd === b.ymd) return 'hoje'
  const amanha = spParts(new Date(now.getTime() + 24 * 3_600_000)).ymd
  if (a.ymd === amanha) return 'amanhã'
  const [, mm, dd] = a.ymd.split('-')
  return `${dd}/${mm}`
}

const horaLabel = (d: Date): string => {
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
    where: { lembretes: { isEmpty: false }, workspace: { whatsappSession: { is: { status: 'CONECTADO' } } } },
    select: { workspaceId: true, lembretes: true },
  })
  let sent = 0
  for (const conn of conns) {
    const kinds = conn.lembretes.filter((k) => k in OFFSETS_MIN).sort((a, b) => (OFFSETS_MIN[a] ?? 0) - (OFFSETS_MIN[b] ?? 0))
    if (kinds.length === 0) continue
    const maxOffset = Math.max(...kinds.map((k) => OFFSETS_MIN[k] ?? 0))
    const events = await db.event.findMany({
      where: {
        workspaceId: conn.workspaceId,
        inicio: { gt: now, lte: new Date(now.getTime() + maxOffset * 60_000) },
        contactId: { not: null },
        contact: { telefone: { not: null }, optOut: false },
      },
      include: { contact: true, reminders: { select: { kind: true } } },
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
        if (!(await claim(ev.id, target, null))) continue

        const result = await sendReminder(conn.workspaceId, ev, contact, now)
        await db.eventReminder.updateMany({ where: { eventId: ev.id, kind: target }, data: { result } })
        if (result === 'enviado') sent++
      } catch (e) {
        logError('reminders', `evento ${ev.id} falhou`, e)
      }
    }
  }
  if (sent > 0) log('reminders', `${sent} lembrete(s) enviado(s)`)
  return sent
}

async function sendReminder(
  workspaceId: string,
  ev: { id: string; inicio: Date; tipo: string },
  contact: { id: string; nome: string; waUserId: string | null; telefone: string | null },
  now: Date,
): Promise<string> {
  const session = await getConnected(workspaceId)
  if (!session) return 'pulado: WhatsApp desconectado'
  const dia = diaLabel(ev.inicio, now)
  const hora = horaLabel(ev.inicio)
  const to = contactRef(contact)
  let content: OutboundContent
  let freeform = false

  if (session.official) {
    const t = await db.template.findFirst({ where: { workspaceId, name: REMINDER_TEMPLATE } })
    if (t && t.status === 'APROVADO') {
      const vars = [firstName(contact.nome), ev.tipo, dia, hora]
      const n = Math.max(0, ...Array.from(t.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
      const used = vars.slice(0, n)
      const body = t.body.replace(/\{\{(\d+)\}\}/g, (_m, i: string) => used[Number(i) - 1] ?? '')
      content = { kind: 'template', name: t.name, vars: used, body }
    } else if (await canSendFreeformTo(session, to)) {
      freeform = true
      content = { kind: 'text', text: `Lembrete: seu horário (${ev.tipo}) é ${dia} às ${hora}.` }
    } else {
      return 'pulado: modelo lembrete_agendamento ausente ou não aprovado'
    }
  } else {
    content = { kind: 'text', text: `Lembrete: seu horário (${ev.tipo}) é ${dia} às ${hora}.` }
  }

  try {
    const conv = await ensureConversation(workspaceId, contact.id)
    await sendAndRecord({ session, conversationId: conv.id, to, author: 'IA', content, countAtendimento: freeform })
    return 'enviado'
  } catch (e) {
    return `erro: ${e instanceof OutboundError ? e.message : shortError(e)}`.slice(0, 200)
  }
}
