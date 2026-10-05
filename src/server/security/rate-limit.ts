// Limite de tentativas (login, segundo fator, redefinição de senha, cadastro...) guardado no BANCO: sobrevive a reinício e
// vale entre instâncias. Só grava HMAC do e-mail e do IP. Relógio injetável (`now`) para teste.
//
// Modelo "reservar e confirmar": a tentativa é gravada como falha ANTES de verificar a senha/código e, se a verificação
// passar, as falhas do e-mail são apagadas. Assim, uma rajada de requisições paralelas não escapa da contagem.
// Tentativas bloqueadas não são gravadas (o bloqueio não se prorroga sozinho).
import { db } from '@/lib/db'
import { hmac } from './hash'

const WINDOW_MS = 15 * 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type Rule = {
  /** Falhas do MESMO e-mail vindas do MESMO IP: só esse IP fica bloqueado (quem erra não tranca a conta do dono). */
  pairMax?: number
  /** Falhas do e-mail, de qualquer IP (teto alto contra ataque distribuído; baixo onde cada pedido gera um e-mail). */
  emailMax: number
  ipMax: number
  windowMs: number
}

export const RULES = {
  /** Login por senha e segundo fator (mesmo balde). 5 erros do mesmo IP no mesmo e-mail bloqueiam esse IP; 50 de IPs variados bloqueiam o e-mail. */
  login: { pairMax: 5, emailMax: 50, ipMax: 30, windowMs: WINDOW_MS },
  /** Pedido de link de redefinição: cada pedido conta. */
  resetRequest: { emailMax: 3, ipMax: 10, windowMs: WINDOW_MS },
  /** Uso do link de redefinição: só por IP. */
  resetConfirm: { emailMax: Infinity, ipMax: 10, windowMs: WINDOW_MS },
  /** Abrir/aceitar um convite da equipe: só por IP (cada consulta de token conta). */
  inviteToken: { emailMax: Infinity, ipMax: 20, windowMs: WINDOW_MS },
  /** Cadastro: por IP (e por e-mail, para não bombardear uma caixa com códigos). O teto global fica no próprio cadastro. */
  register: { emailMax: 3, ipMax: 5, windowMs: HOUR_MS },
  /** Reenvio do código de verificação de e-mail (além do limite por conta de email-verification.ts): por IP. */
  emailSend: { emailMax: Infinity, ipMax: 20, windowMs: HOUR_MS },
  /** Digitar o código de verificação de e-mail: por IP. */
  emailVerify: { emailMax: Infinity, ipMax: 40, windowMs: WINDOW_MS },
  /** Troca de e-mail: pedidos e confirmações por IP e por usuário (a chave de "e-mail" é o id do usuário). */
  emailChange: { emailMax: 12, ipMax: 30, windowMs: HOUR_MS },
} as const satisfies Record<string, Rule>
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

type Where = { emailHash: string } | { ipHash: string } | { emailHash: string; ipHash: string }

/** Segundos até a tentativa mais antiga que ainda conta sair da janela (a `max`-ésima mais recente). */
async function retryAfterFor(where: Where, max: number, windowMs: number, now: number): Promise<number | null> {
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
  const rule: Rule = RULES[action]
  const emailHash = emailKey(action, subject.email)
  const ipHash = ipKey(action, subject.ip)
  maybeCleanup(now)

  const row = await db.loginAttempt.create({ data: { emailHash, ipHash, sucesso: false, createdAt: new Date(now) }, select: { id: true } })
  const since = { gt: new Date(now - rule.windowMs) }
  const pairMax = rule.pairMax ?? Infinity
  const [byEmail, byIp, byPair] = await Promise.all([
    Number.isFinite(rule.emailMax) ? db.loginAttempt.count({ where: { emailHash, sucesso: false, createdAt: since } }) : Promise.resolve(0),
    db.loginAttempt.count({ where: { ipHash, sucesso: false, createdAt: since } }),
    Number.isFinite(pairMax) ? db.loginAttempt.count({ where: { emailHash, ipHash, sucesso: false, createdAt: since } }) : Promise.resolve(0),
  ])
  if (byEmail > rule.emailMax || byIp > rule.ipMax || byPair > pairMax) {
    await db.loginAttempt.delete({ where: { id: row.id } }).catch(() => undefined)
    const waits = await Promise.all([
      byEmail > rule.emailMax ? retryAfterFor({ emailHash }, rule.emailMax, rule.windowMs, now) : null,
      byIp > rule.ipMax ? retryAfterFor({ ipHash }, rule.ipMax, rule.windowMs, now) : null,
      byPair > pairMax ? retryAfterFor({ emailHash, ipHash }, pairMax, rule.windowMs, now) : null,
    ])
    return { blocked: true, retryAfter: Math.max(1, ...waits.filter((w): w is number => w !== null)) }
  }
  return { blocked: false, id: row.id, failures: Math.max(Number.isFinite(pairMax) ? byPair : byEmail, 1) }
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

// ---------------------------------------------------------------------------------------------------------------
// Tetos nomeados (por usuário, organização, negócio ou globais), na mesma tabela e com a mesma limpeza (24 h).
// A chave é HMAC(nome + valor): nada em claro. Cada chamada que passa CONTA (use para ações caras, não para falhas).
// ---------------------------------------------------------------------------------------------------------------

export type Cap = { name: string; key: string; max: number; windowMs: number }
export type CapResult = { blocked: false } | { blocked: true; retryAfter: number; cap: string }

export const HOUR = HOUR_MS
/** Janela máxima de um teto: as linhas somem após 24 h (maybeCleanup). */
export const DAY = DAY_MS

const capKey = (name: string, key: string) => hmac(`cap:${name}`, key)
const CAP_SLOT = hmac('cap-slot', 'x')

/**
 * Registra um uso em TODOS os tetos informados e bloqueia se algum passar do máximo (o uso bloqueado não é gravado).
 * Dois ou mais tetos (ex.: por hora e por dia) são conferidos juntos.
 */
export async function hitCaps(caps: Cap[], now: number = Date.now()): Promise<CapResult> {
  maybeCleanup(now)
  const keys = caps.map((c) => capKey(c.name, c.key))
  const rows = await db.loginAttempt.createManyAndReturn({
    data: keys.map((emailHash) => ({ emailHash, ipHash: CAP_SLOT, sucesso: false, createdAt: new Date(now) })),
    select: { id: true },
  })
  const win = (c: Cap) => Math.min(c.windowMs, DAY_MS)
  const counts = await Promise.all(
    caps.map((c, i) => db.loginAttempt.count({ where: { emailHash: keys[i], ipHash: CAP_SLOT, sucesso: false, createdAt: { gt: new Date(now - win(c)) } } })),
  )
  const over = caps.map((c, i) => ({ c, n: counts[i], i })).filter((x) => x.n > x.c.max)
  if (over.length === 0) return { blocked: false }
  await db.loginAttempt.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }).catch(() => undefined)
  const waits = await Promise.all(over.map((x) => retryAfterFor({ emailHash: keys[x.i], ipHash: CAP_SLOT }, x.c.max, win(x.c), now)))
  return { blocked: true, retryAfter: Math.max(1, ...waits.filter((w): w is number => w !== null)), cap: over[0].c.name }
}
