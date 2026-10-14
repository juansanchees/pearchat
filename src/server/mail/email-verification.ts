// Verificação de e-mail por código de 6 dígitos, SEM mudar o schema: usa VerificationToken e User.emailVerified.
//
// Linhas em VerificationToken (todas por usuário):
//  - `emailverify:<userId>`       o código (token = sha256 com AUTH_SECRET como pepper), expira em 10 min
//  - `emailverify-sent:<userId>`  um registro por envio (expires = envio + 1 h): base do limite de 60 s / 5 por hora
//  - `emailverify-try:<userId>`   um registro por tentativa de verificação do código vigente (limite: 5)
// Os limites vêm do banco, então sobrevivem a reinício e valem entre instâncias.
// O mecanismo é genérico por prefixo (`emailCodeFlow`): o código de "dispositivo novo" do login usa `logincode:`
// (src/server/security/login-code.ts) com as mesmas regras.
//
// Quem é obrigado a verificar (needsEmailVerification): e-mail configurado E conta sem emailVerified E
// (existe código pendente OU a conta foi criada em/depois de EMAIL_VERIFICATION_SINCE). Sem a variável,
// só quem tem código pendente é forçado, isto é, contas antigas nunca são trancadas.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { mailConfigured, sendMail } from './send'
import { type MailContent, verificationCodeEmail, welcomeEmail } from './templates'

export const CODE_TTL_MS = 10 * 60_000
export const RESEND_COOLDOWN_MS = 60_000
export const SENDS_PER_HOUR = 5
export const MAX_ATTEMPTS = 5
const HOUR_MS = 3_600_000

export type IssueResult =
  | { ok: true; sent: boolean; retryAfter: number }
  | { ok: false; reason: 'cooldown' | 'hourly'; retryAfter: number }

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'incorrect'; remaining: number }
  | { ok: false; reason: 'expired' | 'locked' }

type CodeUser = { id: string; email: string; nome: string }

/**
 * Código de 6 dígitos por e-mail, genérico por PREFIXO de identificador (`<prefixo>:<userId>`, `<prefixo>-sent:`,
 * `<prefixo>-try:`): hash com pepper (AUTH_SECRET), 10 min, reenvio 60 s / 5 por hora, 5 tentativas, uso único.
 * Usado pela verificação de e-mail do cadastro (`emailverify`) e pelo código de dispositivo novo (`logincode`).
 */
export function emailCodeFlow(prefix: string, makeMail: (d: { code: string; nome?: string }) => MailContent) {
  const codeId = (userId: string) => `${prefix}:${userId}`
  const sentId = (userId: string) => `${prefix}-sent:${userId}`
  const tryId = (userId: string) => `${prefix}-try:${userId}`
  const hashCode = (userId: string, code: string) =>
    createHash('sha256').update(`${process.env.AUTH_SECRET ?? ''}:${prefix}:${userId}:${code}`).digest('hex')

  /** Segundos até poder pedir outro código (0 = já pode) e se o limite por hora foi atingido. */
  async function sendState(userId: string): Promise<{ retryAfter: number; reason?: 'cooldown' | 'hourly' }> {
    const now = Date.now()
    const rows = await db.verificationToken.findMany({
      where: { identifier: sentId(userId), expires: { gt: new Date(now) } },
      select: { expires: true },
      orderBy: { expires: 'asc' },
    })
    if (!rows.length) return { retryAfter: 0 }
    const sentTimes = rows.map((r) => r.expires.getTime() - HOUR_MS)
    const last = Math.max(...sentTimes)
    const cooldown = Math.max(0, Math.ceil((last + RESEND_COOLDOWN_MS - now) / 1000))
    if (rows.length >= SENDS_PER_HOUR) {
      const hourly = Math.max(0, Math.ceil((Math.min(...sentTimes) + HOUR_MS - now) / 1000))
      return { retryAfter: Math.max(hourly, cooldown), reason: 'hourly' }
    }
    return cooldown > 0 ? { retryAfter: cooldown, reason: 'cooldown' } : { retryAfter: 0 }
  }

  /** Existe código vigente (não expirado) para o usuário? */
  async function hasActiveCode(userId: string): Promise<boolean> {
    const row = await db.verificationToken.findFirst({
      where: { identifier: codeId(userId), expires: { gt: new Date() } },
      select: { identifier: true },
    })
    return !!row
  }

  /** Existe linha de código (vigente ou não)? */
  async function hasPendingCode(userId: string): Promise<boolean> {
    const row = await db.verificationToken.findFirst({ where: { identifier: codeId(userId) }, select: { identifier: true } })
    return !!row
  }

  /** Gera um código novo (invalida o anterior), respeitando os limites, e o envia por e-mail. */
  async function issue(user: CodeUser): Promise<IssueResult> {
    const state = await sendState(user.id)
    if (state.retryAfter > 0 && state.reason) return { ok: false, reason: state.reason, retryAfter: state.retryAfter }

    const now = Date.now()
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await db.$transaction([
      db.verificationToken.deleteMany({ where: { identifier: { in: [codeId(user.id), tryId(user.id)] } } }),
      db.verificationToken.deleteMany({ where: { identifier: sentId(user.id), expires: { lte: new Date(now) } } }),
      db.verificationToken.create({
        data: { identifier: codeId(user.id), token: hashCode(user.id, code), expires: new Date(now + CODE_TTL_MS) },
      }),
      db.verificationToken.create({
        data: { identifier: sentId(user.id), token: randomBytes(12).toString('hex'), expires: new Date(now + HOUR_MS) },
      }),
    ])

    const res = await sendMail({ to: user.email, ...makeMail({ code, nome: user.nome }) })
    return { ok: true, sent: res.ok, retryAfter: Math.ceil(RESEND_COOLDOWN_MS / 1000) }
  }

  /** Confere o código. Cada chamada gasta uma tentativa ANTES de comparar (vale também sob concorrência). Uso único. */
  async function verify(userId: string, input: string): Promise<VerifyResult> {
    const row = await db.verificationToken.findFirst({ where: { identifier: codeId(userId) } })
    if (!row || row.expires.getTime() < Date.now()) {
      return { ok: false, reason: 'expired' } // a linha fica: continua contando como "pendente"
    }

    await db.verificationToken.create({
      data: { identifier: tryId(userId), token: randomBytes(12).toString('hex'), expires: row.expires },
    })
    const used = await db.verificationToken.count({ where: { identifier: tryId(userId) } })
    if (used > MAX_ATTEMPTS) {
      await clearCode(userId)
      return { ok: false, reason: 'locked' }
    }

    const a = Buffer.from(hashCode(userId, String(input ?? '')), 'hex')
    const b = Buffer.from(row.token, 'hex')
    const match = a.length === b.length && timingSafeEqual(a, b)
    if (!match) {
      if (used >= MAX_ATTEMPTS) {
        await clearCode(userId)
        return { ok: false, reason: 'locked' }
      }
      return { ok: false, reason: 'incorrect', remaining: MAX_ATTEMPTS - used }
    }

    // Uso único: só segue quem de fato consumiu o código.
    const consumed = await db.verificationToken.deleteMany({ where: { identifier: codeId(userId), token: row.token } })
    if (consumed.count !== 1) return { ok: false, reason: 'expired' }
    await db.verificationToken.deleteMany({ where: { identifier: { in: [tryId(userId), sentId(userId)] } } })
    return { ok: true }
  }

  /** Invalida o código vigente sem apagar a linha (só um novo código destrava). */
  async function clearCode(userId: string) {
    await db.verificationToken.updateMany({ where: { identifier: codeId(userId) }, data: { token: randomBytes(32).toString('hex') } })
  }

  return { sendState, hasActiveCode, hasPendingCode, issue, verify }
}

// ---------- Verificação de e-mail do cadastro ----------

const signupFlow = emailCodeFlow('emailverify', verificationCodeEmail)

export const sendState = signupFlow.sendState
export const hasActiveCode = signupFlow.hasActiveCode

/** Gera um código novo (invalida o anterior), respeitando os limites, e o envia por e-mail. */
export function issueEmailCode(user: CodeUser): Promise<IssueResult> {
  return signupFlow.issue(user)
}

/** Confere o código; no acerto marca o e-mail como verificado e manda as boas-vindas. */
export async function verifyEmailCode(user: CodeUser, input: string): Promise<VerifyResult> {
  const r = await signupFlow.verify(user.id, input)
  if (!r.ok) return r
  await db.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } })
  void sendWelcome(user)
  return { ok: true }
}

/** E-mail de boas-vindas (melhor esforço; só se o serviço de e-mail estiver configurado). */
export async function sendWelcome(user: { email: string; nome: string }): Promise<void> {
  if (!mailConfigured()) return
  await sendMail({ to: user.email, ...welcomeEmail({ nome: user.nome }) }).catch(() => undefined)
}

/** Esta conta deve ser levada para /verificar-email? (critério documentado no topo do arquivo) */
export async function needsEmailVerification(userId: string): Promise<boolean> {
  if (!mailConfigured()) return false
  const user = await db.user.findUnique({ where: { id: userId }, select: { emailVerified: true, createdAt: true } })
  if (!user || user.emailVerified) return false
  const since = process.env.EMAIL_VERIFICATION_SINCE ? new Date(process.env.EMAIL_VERIFICATION_SINCE) : null
  if (since && !Number.isNaN(since.getTime()) && user.createdAt >= since) return true
  return signupFlow.hasPendingCode(userId)
}

// ---------------------------------------------------------------------------------------------------------------
// Barreira no SERVIDOR (as rotas /api que enviam mensagens, gastam IA, convidam pessoas ou conectam o WhatsApp).
// Mesma regra de needsEmailVerification (e-mail configurado + conta sem verificação + criada desde
// EMAIL_VERIFICATION_SINCE ou com código pendente), então contas antigas e a do dono NUNCA são trancadas e, sem
// serviço de e-mail (hoje em produção), a verificação não é exigida: criar conta e usar o app seguem como antes.
// ---------------------------------------------------------------------------------------------------------------

const clearUntil = new Map<string, number>()
const CLEAR_TTL_MS = 60_000

/** needsEmailVerification com cache curto só do "não precisa" (uma consulta por minuto por usuário). "Precisa" nunca é cacheado. */
export async function emailGateBlocks(userId: string): Promise<boolean> {
  const now = Date.now()
  const until = clearUntil.get(userId)
  if (until && until > now) return false
  const needs = await needsEmailVerification(userId)
  if (!needs) {
    if (clearUntil.size > 5000) for (const [k, v] of Array.from(clearUntil)) if (v <= now) clearUntil.delete(k)
    clearUntil.set(userId, now + CLEAR_TTL_MS)
  }
  return needs
}

export function forgetEmailGate(userId: string): void {
  clearUntil.delete(userId)
}
