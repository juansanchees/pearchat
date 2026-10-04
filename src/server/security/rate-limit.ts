// Limite de tentativas (login, segundo fator, redefinição de senha) guardado no BANCO: sobrevive a reinício e vale entre
// instâncias. Só grava HMAC do e-mail e do IP. Relógio injetável (`now`) para teste.
//
// Modelo "reservar e confirmar": a tentativa é gravada como falha ANTES de verificar a senha/código e, se a verificação
// passar, as falhas do e-mail são apagadas. Assim, uma rajada de requisições paralelas não escapa da contagem.
// Tentativas bloqueadas não são gravadas (o bloqueio não se prorroga sozinho).
import { db } from '@/lib/db'
import { hmac } from './hash'

const WINDOW_MS = 15 * 60_000

export const RULES = {
  /** Login por senha e segundo fator (mesmo balde). */
  login: { emailMax: 5, ipMax: 30, windowMs: WINDOW_MS },
  /** Pedido de link de redefinição: cada pedido conta. */
  resetRequest: { emailMax: 3, ipMax: 10, windowMs: WINDOW_MS },
  /** Uso do link de redefinição: só por IP. */
  resetConfirm: { emailMax: Infinity, ipMax: 10, windowMs: WINDOW_MS },
} as const
export type LimitAction = keyof typeof RULES

export type Subject = { email?: string; ip: string }
export type Reservation = { blocked: true; retryAfter: number } | { blocked: false; id: string; failures: number }

const emailKey = (action: LimitAction, email?: string) => hmac(`rl:${action}:email`, (email ?? '-').trim().toLowerCase())
const ipKey = (action: LimitAction, ip: string) => hmac(`rl:${action}:ip`, ip)

let lastCleanup = 0
/** Limpeza preguiçosa: apaga tentativas com mais de 24 h, no máximo uma vez a cada 10 min por processo. */
function maybeCleanup(now: number) {
  if (now - lastCleanup < 10 * 60_000) return
  lastCleanup = now
  void db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now - 24 * 3_600_000) } } }).catch(() => undefined)
}

/** Segundos até a tentativa mais antiga que ainda conta sair da janela (a `max`-ésima mais recente). */
async function retryAfterFor(where: { emailHash: string } | { ipHash: string }, max: number, windowMs: number, now: number): Promise<number | null> {
  if (!Number.isFinite(max)) return null
  const rows = await db.loginAttempt.findMany({
    where: { ...where, sucesso: false, createdAt: { gt: new Date(now - windowMs) } },
    orderBy: { createdAt: 'desc' },
    take: max,
    select: { createdAt: true },
  })
  if (rows.length < max) return null
  return Math.max(1, Math.ceil((rows[max - 1].createdAt.getTime() + windowMs - now) / 1000))
}

export async function reserve(action: LimitAction, subject: Subject, now: number = Date.now()): Promise<Reservation> {
  const rule = RULES[action]
  const emailHash = emailKey(action, subject.email)
  const ipHash = ipKey(action, subject.ip)
  maybeCleanup(now)

  const row = await db.loginAttempt.create({ data: { emailHash, ipHash, sucesso: false, createdAt: new Date(now) }, select: { id: true } })
  const [byEmail, byIp] = await Promise.all([
    Number.isFinite(rule.emailMax)
      ? db.loginAttempt.count({ where: { emailHash, sucesso: false, createdAt: { gt: new Date(now - rule.windowMs) } } })
      : Promise.resolve(0),
    db.loginAttempt.count({ where: { ipHash, sucesso: false, createdAt: { gt: new Date(now - rule.windowMs) } } }),
  ])
  if (byEmail > rule.emailMax || byIp > rule.ipMax) {
    await db.loginAttempt.delete({ where: { id: row.id } }).catch(() => undefined)
    const waits = await Promise.all([
      byEmail > rule.emailMax ? retryAfterFor({ emailHash }, rule.emailMax, rule.windowMs, now) : null,
      byIp > rule.ipMax ? retryAfterFor({ ipHash }, rule.ipMax, rule.windowMs, now) : null,
    ])
    return { blocked: true, retryAfter: Math.max(1, ...waits.filter((w): w is number => w !== null)) }
  }
  return { blocked: false, id: row.id, failures: Math.max(byEmail, 1) }
}

/** Verificação passou: zera o contador do e-mail (apaga as falhas dele, inclusive a reservada) e registra o sucesso. */
export async function markSuccess(action: LimitAction, subject: Subject, now: number = Date.now()): Promise<void> {
  const emailHash = emailKey(action, subject.email)
  await db.$transaction([
    db.loginAttempt.deleteMany({ where: { emailHash, sucesso: false } }),
    db.loginAttempt.create({ data: { emailHash, ipHash: ipKey(action, subject.ip), sucesso: true, createdAt: new Date(now) } }),
  ])
}

/** A etapa não é uma falha (ex.: senha certa, falta o segundo fator): devolve a reserva. */
export async function release(reservation: Extract<Reservation, { blocked: false }>): Promise<void> {
  await db.loginAttempt.delete({ where: { id: reservation.id } }).catch(() => undefined)
}

/** Para ações que contam todo pedido (redefinição de senha): reserva e mantém. */
export async function consume(action: LimitAction, subject: Subject, now: number = Date.now()): Promise<{ blocked: boolean; retryAfter: number }> {
  const r = await reserve(action, subject, now)
  return r.blocked ? { blocked: true, retryAfter: r.retryAfter } : { blocked: false, retryAfter: 0 }
}

/** Atraso progressivo pequeno nas respostas de falha (250 ms por falha acumulada, até 1,5 s). */
export function failureDelayMs(failures: number): number {
  return Math.min(250 * Math.max(0, failures - 1), 1500)
}
export const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

export const BLOCKED_MESSAGE = 'Muitas tentativas. Tente de novo em alguns minutos.'
