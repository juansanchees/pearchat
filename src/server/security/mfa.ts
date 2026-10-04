// Verificação em duas etapas: desafio assinado, conferência de código (TOTP e recuperação), ativação e desativação.
import { createHmac, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import QRCode from 'qrcode'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { decrypt, encrypt } from '@/server/whatsapp/crypto'
import { mailConfigured, sendMail } from '@/server/mail/send'
import { twoFactorChangedEmail } from '@/server/mail/templates'
import { hmac, safeEqual } from './hash'
import { generateSecret, matchStep, otpauthUrl } from './totp'

// ---------- Desafio do segundo fator ----------
// Token assinado (HMAC-SHA256 com AUTH_SECRET), 5 min, ligado ao usuário, de uso único (jti consumido no sucesso).
// Não é uma sessão: nenhuma rota do app aceita este valor.

export const CHALLENGE_TTL_MS = 5 * 60_000
export const MFA_COOKIE = 'pc_mfa'

type ChallengePayload = { u: string; e: number; j: string; r: boolean; cb: string }
const sign = (body: string) => createHmac('sha256', process.env.AUTH_SECRET ?? '').update(`mfa-challenge\u0000${body}`).digest('base64url')

export function issueChallenge(userId: string, opts: { remember: boolean; callbackUrl: string }, now = Date.now()): string {
  const p: ChallengePayload = { u: userId, e: now + CHALLENGE_TTL_MS, j: randomBytes(16).toString('base64url'), r: opts.remember, cb: opts.callbackUrl }
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function readChallenge(token: string, now = Date.now()): ChallengePayload | null {
  if (typeof token !== 'string' || token.length > 2000) return null
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined) return null
  if (!safeEqual(mac, sign(body))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload
    if (typeof p.u !== 'string' || typeof p.j !== 'string' || typeof p.e !== 'number' || p.e < now) return null
    return p
  } catch {
    return null
  }
}

/** Marca o desafio como usado. false = já tinha sido usado (replay). */
export async function consumeChallenge(p: { j: string; e: number }): Promise<boolean> {
  try {
    await db.verificationToken.create({ data: { identifier: 'mfa-challenge-used', token: p.j, expires: new Date(p.e + 60_000) } })
    return true
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false // já usado
    throw e
  }
}

// ---------- Códigos de recuperação ----------

const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // sem 0/o/1/l/i
export const RECOVERY_COUNT = 10

export function normalizeRecovery(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '')
}
const recoveryHash = (userId: string, normalized: string) => hmac('recovery-code', `${userId}:${normalized}`)

function newRecoveryCode(): string {
  const bytes = randomBytes(10)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += RC_ALPHABET[bytes[i] % RC_ALPHABET.length]
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode)
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId } }),
    db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: recoveryHash(userId, normalizeRecovery(c)) })) }),
  ])
  return codes
}

/** Consome um código de recuperação (uso único, atômico). */
async function consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
  const n = normalizeRecovery(input)
  if (n.length !== 10) return false
  const row = await db.recoveryCode.findFirst({ where: { userId, codeHash: recoveryHash(userId, n), usedAt: null }, select: { id: true } })
  if (!row) return false
  const r = await db.recoveryCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
  return r.count === 1
}

// ---------- Conferência de código (TOTP ou recuperação) ----------

type MfaUser = { id: string; totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null }

/** TOTP com proteção contra reuso: o passo aceito só vale se for maior que o último aceito (atômico no banco). */
export async function verifyTotpAndConsume(user: MfaUser, code: string, now = Date.now()): Promise<boolean> {
  if (!user.totpSecret) return false
  let secret: string
  try {
    secret = decrypt(user.totpSecret)
  } catch {
    return false
  }
  const step = matchStep(secret, code, now)
  if (step === null) return false
  if (user.totpLastStep !== null && step <= user.totpLastStep) return false
  const r = await db.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  })
  return r.count === 1
}

/** Código de 6 dígitos = TOTP; qualquer outro formato = código de recuperação. Só vale com o 2FA ativo. */
export async function verifySecondFactor(userId: string, code: string, now = Date.now()): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true } })
  if (!user?.totpEnabledAt || !user.totpSecret) return false
  const c = code.trim()
  if (/^\d{6}$/.test(c)) return verifyTotpAndConsume(user, c, now)
  return consumeRecoveryCode(user.id, c)
}

// ---------- Ativação, desativação e novos códigos ----------

export class MfaError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
  }
}

async function notify(user: { email: string; nome: string }, ativada: boolean) {
  if (!mailConfigured()) return
  await sendMail({ to: user.email, ...twoFactorChangedEmail({ ativada, nome: user.nome }) }).catch(() => undefined)
}

export async function mfaState(userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, passwordHash: true, _count: { select: { recoveryCodes: { where: { usedAt: null } } } } },
  })
  if (!u) throw new MfaError('Usuário não encontrado', 404)
  return { enabled: !!u.totpEnabledAt, hasPassword: !!u.passwordHash, recoveryLeft: u._count.recoveryCodes }
}

/** Gera um segredo pendente (ainda não vale no login) e devolve a chave + QR. A chave só sai aqui, durante a ativação. */
export async function beginSetup(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, totpEnabledAt: true, passwordHash: true } })
  if (!u) throw new MfaError('Usuário não encontrado', 404)
  if (u.totpEnabledAt) throw new MfaError('A verificação em duas etapas já está ativa.', 409)
  // O login pelo Google não passa pelo segundo fator: sem senha a pessoa ficaria sem caminho de entrada.
  if (!u.passwordHash) throw new MfaError('Crie uma senha antes (use "Esqueci minha senha" na tela de entrada) para ativar a verificação em duas etapas.', 409)
  const secret = generateSecret()
  await db.user.update({ where: { id: userId }, data: { totpSecret: encrypt(secret), totpLastStep: null } })
  const uri = otpauthUrl(secret, u.email)
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d2117', light: '#ffffff' } })
  return { secret, otpauth: uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }
}

/** Confirma o primeiro código, liga o 2FA e devolve os códigos de recuperação (única vez em que aparecem). */
export async function confirmSetup(userId: string, code: string, now = Date.now()): Promise<string[]> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, nome: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true } })
  if (!u) throw new MfaError('Usuário não encontrado', 404)
  if (u.totpEnabledAt) throw new MfaError('A verificação em duas etapas já está ativa.', 409)
  if (!u.totpSecret) throw new MfaError('Comece a ativação de novo.', 409)
  if (!(await verifyTotpAndConsume(u, code.trim(), now))) throw new MfaError('Código incorreto. Confira o aplicativo e tente de novo.')
  const on = await db.user.updateMany({ where: { id: userId, totpEnabledAt: null }, data: { totpEnabledAt: new Date(now) } })
  if (on.count !== 1) throw new MfaError('A verificação em duas etapas já está ativa.', 409)
  const codes = await replaceRecoveryCodes(userId)
  void notify(u, true)
  return codes
}

/** Desativar: senha (se a conta tem senha) + código válido. Apaga segredo e códigos e derruba as sessões. */
export async function disableMfa(userId: string, input: { password?: string; code: string }, now = Date.now()): Promise<void> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, nome: true, passwordHash: true, totpEnabledAt: true } })
  if (!u) throw new MfaError('Usuário não encontrado', 404)
  if (!u.totpEnabledAt) throw new MfaError('A verificação em duas etapas não está ativa.', 409)
  if (u.passwordHash) {
    const okPwd = !!input.password && (await bcrypt.compare(input.password, u.passwordHash))
    if (!okPwd) throw new MfaError('Senha incorreta.')
  }
  if (!(await verifySecondFactor(userId, input.code, now))) throw new MfaError('Código incorreto.')
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId } }),
    db.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, sessionVersion: { increment: 1 } },
    }),
  ])
  void notify(u, false)
}

/** Novos códigos de recuperação (os antigos deixam de valer). Exige um código válido. */
export async function regenerateRecovery(userId: string, code: string, now = Date.now()): Promise<string[]> {
  if (!(await verifySecondFactor(userId, code, now))) throw new MfaError('Código incorreto.')
  return replaceRecoveryCodes(userId)
}

/** "Sair de todos os dispositivos": nova versão de sessão, todos os tokens antigos deixam de valer. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
}
