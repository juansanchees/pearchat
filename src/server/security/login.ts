// Núcleo do login por e-mail e senha, com limite de tentativas e segundo fator. Usado pelo `authorize` do Auth.js
// (único ponto que emite sessão) e pela ação do formulário (que precisa saber se há segundo fator).
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { maskEmail } from '@/server/audit/log'
import { mailConfigured } from '@/server/mail/send'
import { isTrustedDevice } from './device'
import { issueLoginCode, verifyLoginCode } from './login-code'
import { consumeChallenge, issueChallenge, readChallenge, verifySecondFactor, type ChallengeMethod } from './mfa'
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
  sessionVersion: true, // dispositivo confiável vale só para a versão de sessão em que foi gravado
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
  | { kind: 'mfa'; challenge: string; method: ChallengeMethod; emailMasked?: string }
  | { kind: 'ok'; user: LoginUser }

type Opts = {
  now?: number
  remember?: boolean
  callbackUrl?: string
  delay?: boolean
  /** Valor do cookie `pc_dev` deste navegador (dispositivo confiável). */
  deviceToken?: string | null
  /** false: não envia o código por e-mail (o `authorize` só precisa saber que falta o segundo passo). Padrão: envia. */
  sendCode?: boolean
}

/**
 * Primeiro fator. Senha correta devolve só um desafio (nenhuma sessão) quando:
 *  - a conta tem 2FA (aplicativo autenticador): desafio 'totp';
 *  - ou, sem 2FA, o serviço de e-mail está configurado e este navegador não é um dispositivo confiável da conta:
 *    desafio 'email' e um código de 6 dígitos vai para o e-mail da conta.
 * Senão devolve o usuário. Sem serviço de e-mail o login segue como antes (ninguém fica trancado fora).
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
  const base = { remember: opts.remember ?? true, callbackUrl: opts.callbackUrl ?? '/' }
  if (user.totpEnabledAt) {
    await release(res) // senha certa não é falha; o segundo fator tem a própria contagem
    return { kind: 'mfa', method: 'totp', challenge: issueChallenge(user.id, { ...base, method: 'totp' }, now) }
  }
  if (mailConfigured() && !isTrustedDevice(opts.deviceToken, user, now)) {
    await release(res)
    // Dentro do prazo de reenvio o código anterior continua valendo (issueLoginCode não gera outro): nada a fazer.
    if (opts.sendCode !== false) await issueLoginCode({ id: user.id, email: user.email, nome: user.nome })
    const emailMasked = maskEmail(user.email)
    return { kind: 'mfa', method: 'email', emailMasked, challenge: issueChallenge(user.id, { ...base, method: 'email', emailMasked }, now) }
  }
  await markSuccess('login', { email, ip }, now)
  return { kind: 'ok', user: toLoginUser(user) }
}

export type SecondResult =
  | { kind: 'blocked'; retryAfter: number }
  | { kind: 'expired' }
  /** `codeLocked`: o código por e-mail expirou ou travou (5 erros); só um novo ("Reenviar código") destrava. */
  | { kind: 'invalid'; codeLocked?: boolean }
  | { kind: 'ok'; user: LoginUser; method: ChallengeMethod }

/**
 * Segundo fator: desafio válido (assinado, uso único) + código conforme o tipo do desafio: TOTP ou de recuperação
 * ('totp'), ou o código enviado por e-mail ('email'). Emite o usuário só se tudo bater.
 */
export async function secondFactorLogin(challenge: string, code: string, ip: string, opts: Opts = {}): Promise<SecondResult> {
  const now = opts.now ?? Date.now()
  const ch = readChallenge(challenge, now)
  if (!ch) return { kind: 'expired' }
  const user = await loadUser({ id: ch.u })
  if (!user || user.desativadoEm) return { kind: 'expired' }
  // O tipo do desafio tem que continuar valendo: 2FA ligado depois do desafio por e-mail (ou desligado) recomeça o login.
  if (ch.t === 'totp' ? !user.totpEnabledAt : !!user.totpEnabledAt || !mailConfigured()) return { kind: 'expired' }

  const res = await reserve('login', { email: user.email, ip }, now)
  if (res.blocked) return { kind: 'blocked', retryAfter: res.retryAfter }

  let ok: boolean
  let codeLocked = false
  if (ch.t === 'email') {
    const v = await verifyLoginCode(user.id, code.trim())
    ok = v.ok
    codeLocked = !v.ok && v.reason !== 'incorrect'
  } else {
    ok = await verifySecondFactor(user.id, code, now)
  }
  if (!ok) {
    if (opts.delay !== false) await sleep(failureDelayMs(res.failures))
    return codeLocked ? { kind: 'invalid', codeLocked } : { kind: 'invalid' }
  }
  // Desafio de uso único: quem perde a corrida (mesmo desafio usado duas vezes) não entra.
  if (!(await consumeChallenge(ch))) return { kind: 'expired' }
  await markSuccess('login', { email: user.email, ip }, now)
  return { kind: 'ok', user: toLoginUser(user), method: ch.t }
}
