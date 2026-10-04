// Núcleo do login por e-mail e senha, com limite de tentativas e segundo fator. Usado pelo `authorize` do Auth.js
// (único ponto que emite sessão) e pela ação do formulário (que precisa saber se há segundo fator).
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { consumeChallenge, issueChallenge, readChallenge, verifySecondFactor } from './mfa'
import { failureDelayMs, markSuccess, release, reserve, sleep } from './rate-limit'

// Hash descartável: a comparação roda mesmo quando a conta não existe (mesmo custo, sem vazar a existência).
let dummyHash: string | null = null
const dummy = () => (dummyHash ??= bcrypt.hashSync('pearchat-dummy-password', 10))

const userSelect = {
  id: true,
  email: true,
  nome: true,
  image: true,
  fotoUrl: true,
  workspaceId: true,
  organizationId: true,
  passwordHash: true,
  totpEnabledAt: true,
  desativadoEm: true, // Equipe: removido da equipe não entra (mesma resposta genérica de senha inválida)
} as const

export type LoginUser = {
  id: string
  email: string
  name: string
  image: string | null
  workspaceId: string
  organizationId: string | null
  nome: string
}

type Row = Awaited<ReturnType<typeof loadUser>>
const loadUser = (where: { email: string } | { id: string }) => db.user.findUnique({ where, select: userSelect })
const toLoginUser = (u: NonNullable<Row>): LoginUser => ({
  id: u.id,
  email: u.email,
  name: u.nome,
  image: u.fotoUrl ?? u.image,
  workspaceId: u.workspaceId,
  organizationId: u.organizationId ?? null,
  nome: u.nome,
})

export type PrimaryResult =
  | { kind: 'blocked'; retryAfter: number }
  | { kind: 'invalid' }
  | { kind: 'mfa'; challenge: string }
  | { kind: 'ok'; user: LoginUser }

type Opts = { now?: number; remember?: boolean; callbackUrl?: string; delay?: boolean }

/**
 * Primeiro fator. Com 2FA ativo, senha correta devolve só um desafio (nenhuma sessão); sem 2FA devolve o usuário.
 * Falhas são gravadas antes da conferência (uma rajada paralela não escapa) e adiadas de forma progressiva.
 */
export async function primaryLogin(rawEmail: string, password: string, ip: string, opts: Opts = {}): Promise<PrimaryResult> {
  const email = rawEmail.trim().toLowerCase()
  const now = opts.now ?? Date.now()
  const res = await reserve('login', { email, ip }, now)
  if (res.blocked) return { kind: 'blocked', retryAfter: res.retryAfter }

  const user = await loadUser({ email })
  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummy())
  if (!user?.passwordHash || !ok || user.desativadoEm) {
    if (opts.delay !== false) await sleep(failureDelayMs(res.failures))
    return { kind: 'invalid' }
  }
  if (user.totpEnabledAt) {
    await release(res) // senha certa não é falha; o segundo fator tem a própria contagem
    return { kind: 'mfa', challenge: issueChallenge(user.id, { remember: opts.remember ?? true, callbackUrl: opts.callbackUrl ?? '/' }, now) }
  }
  await markSuccess('login', { email, ip }, now)
  return { kind: 'ok', user: toLoginUser(user) }
}

export type SecondResult = { kind: 'blocked'; retryAfter: number } | { kind: 'expired' } | { kind: 'invalid' } | { kind: 'ok'; user: LoginUser }

/** Segundo fator: desafio válido (assinado, 5 min, uso único) + código TOTP ou de recuperação. Emite o usuário só se tudo bater. */
export async function secondFactorLogin(challenge: string, code: string, ip: string, opts: Opts = {}): Promise<SecondResult> {
  const now = opts.now ?? Date.now()
  const ch = readChallenge(challenge, now)
  if (!ch) return { kind: 'expired' }
  const user = await loadUser({ id: ch.u })
  if (!user?.totpEnabledAt || user.desativadoEm) return { kind: 'expired' }

  const res = await reserve('login', { email: user.email, ip }, now)
  if (res.blocked) return { kind: 'blocked', retryAfter: res.retryAfter }

  const ok = await verifySecondFactor(user.id, code, now)
  if (!ok) {
    if (opts.delay !== false) await sleep(failureDelayMs(res.failures))
    return { kind: 'invalid' }
  }
  // Desafio de uso único: quem perde a corrida (mesmo desafio usado duas vezes) não entra.
  if (!(await consumeChallenge(ch))) return { kind: 'expired' }
  await markSuccess('login', { email: user.email, ip }, now)
  return { kind: 'ok', user: toLoginUser(user) }
}
