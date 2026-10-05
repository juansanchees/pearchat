// Troca do e-mail de login, SEM mudar o schema: usa VerificationToken (como a verificação de e-mail e o reset de senha).
//
// Regras:
//  - exige a senha atual (e o código do 2FA, se a conta tem); conta só-Google não troca por aqui;
//  - o e-mail novo só passa a valer depois de confirmado por um código de 6 dígitos enviado ao NOVO endereço
//    (hash com pepper do AUTH_SECRET, 10 min, uso único, 5 tentativas);
//  - o e-mail ANTIGO é avisado (no pedido e na conclusão);
//  - ao concluir: sessionVersion sobe (todas as sessões caem), links de redefinição pendentes são apagados e o
//    emailVerified vale pelo endereço novo (ele provou a posse);
//  - sem serviço de e-mail configurado a troca fica indisponível (nunca troca sem confirmar).
//
// Linhas em VerificationToken (por usuário):
//  - `emailchange:<userId>:<base64url(novoEmail)>`  o código (hash), expira em 10 min; no máximo uma
//  - `emailchange-sent:<userId>`                    um registro por envio (expires = envio + 1 h): 60 s / 5 por hora
//  - `emailchange-try:<userId>`                     um registro por tentativa do código vigente (limite: 5)

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { audit, maskEmail } from '@/server/audit/log'
import { disconnectUser } from '@/server/realtime/emit'
import { consume, failureDelayMs, release, reserve, sleep } from '@/server/security/rate-limit'
import { verifySecondFactor } from '@/server/security/mfa'
import { invalidateActiveSpace } from '@/server/spaces/org'
import { forgetEmailGate } from './email-verification'
import { mailConfigured, sendMail } from './send'
import { emailChangeCodeEmail, emailChangeNoticeEmail } from './templates'

export const CHANGE_CODE_TTL_MS = 10 * 60_000
export const CHANGE_COOLDOWN_MS = 60_000
export const CHANGE_SENDS_PER_HOUR = 5
export const CHANGE_MAX_ATTEMPTS = 5
const HOUR_MS = 3_600_000

export const MSG_INDISPONIVEL = 'A troca de e-mail está indisponível no momento, porque o envio de e-mails não está configurado.'
export const MSG_SO_GOOGLE = 'Esta conta entra com o Google e não tem senha, então o e-mail não pode ser trocado por aqui. Crie uma senha em "Esqueci minha senha" na tela de entrada.'

export class EmailChangeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public retryAfter?: number,
  ) {
    super(message)
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')
const codePrefix = (userId: string) => `emailchange:${userId}:`
const sentId = (userId: string) => `emailchange-sent:${userId}`
const tryId = (userId: string) => `emailchange-try:${userId}`
const hashCode = (userId: string, novoEmail: string, code: string) =>
  createHash('sha256').update(`${process.env.AUTH_SECRET ?? ''}:emailchange:${userId}:${novoEmail}:${code}`).digest('hex')

export type ChangeUser = { id: string; email: string; nome: string; organizationId: string | null }
const userSelect = { id: true, email: true, nome: true, organizationId: true, passwordHash: true, totpEnabledAt: true } as const

/** Estado para a tela: a troca está disponível? a conta tem senha/2FA? há um pedido pendente? */
export async function emailChangeState(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true, totpEnabledAt: true } })
  const row = await db.verificationToken.findFirst({ where: { identifier: { startsWith: codePrefix(userId) }, expires: { gt: new Date() } } })
  return {
    disponivel: mailConfigured(),
    temSenha: !!u?.passwordHash,
    doisFatores: !!u?.totpEnabledAt,
    pendente: row ? { novoEmail: maskEmail(unb64(row.identifier.slice(codePrefix(userId).length))) } : null,
  }
}

async function checkSendState(userId: string): Promise<void> {
  const now = Date.now()
  const rows = await db.verificationToken.findMany({ where: { identifier: sentId(userId), expires: { gt: new Date(now) } }, select: { expires: true } })
  if (!rows.length) return
  const times = rows.map((r) => r.expires.getTime() - HOUR_MS)
  const cooldown = Math.max(0, Math.ceil((Math.max(...times) + CHANGE_COOLDOWN_MS - now) / 1000))
  if (rows.length >= CHANGE_SENDS_PER_HOUR) {
    const hourly = Math.ceil((Math.min(...times) + HOUR_MS - now) / 1000)
    throw new EmailChangeError('Você pediu códigos demais. Tente de novo mais tarde.', 429, 'hourly', Math.max(hourly, cooldown))
  }
  if (cooldown > 0) throw new EmailChangeError(`Aguarde ${cooldown}s para pedir outro código.`, 429, 'cooldown', cooldown)
}

/**
 * Pede a troca: confere a senha (e o 2FA), grava o código para o endereço novo e o envia. Nada muda no usuário ainda.
 * Lança EmailChangeError com status e mensagem prontos para a tela.
 */
export async function requestEmailChange(
  userId: string,
  input: { novoEmail: string; password: string; code2fa?: string },
  ip: string,
): Promise<{ retryAfter: number }> {
  if (!mailConfigured()) throw new EmailChangeError(MSG_INDISPONIVEL, 503, 'unavailable')
  const novoEmail = input.novoEmail.trim().toLowerCase()

  const rl = await consume('emailChange', { email: userId, ip })
  if (rl.blocked) throw new EmailChangeError('Muitas tentativas. Tente de novo em alguns minutos.', 429, 'rate_limited', rl.retryAfter)

  const u = await db.user.findUnique({ where: { id: userId }, select: userSelect })
  if (!u) throw new EmailChangeError('Usuário não encontrado.', 404, 'not_found')
  if (!u.passwordHash) throw new EmailChangeError(MSG_SO_GOOGLE, 409, 'no_password')

  // Senha atual: tentativas erradas contam no MESMO limite do login (quem tem só a sessão não adivinha a senha por aqui).
  const res = await reserve('login', { email: u.email, ip })
  if (res.blocked) throw new EmailChangeError('Muitas tentativas. Tente de novo em alguns minutos.', 429, 'rate_limited', res.retryAfter)
  if (!(await bcrypt.compare(input.password, u.passwordHash))) {
    await sleep(failureDelayMs(res.failures))
    throw new EmailChangeError('Senha incorreta.', 400, 'wrong_password')
  }
  if (u.totpEnabledAt && !(input.code2fa && (await verifySecondFactor(u.id, input.code2fa.trim())))) {
    await sleep(failureDelayMs(res.failures))
    throw new EmailChangeError(input.code2fa ? 'Código da verificação em duas etapas incorreto.' : 'Digite o código da verificação em duas etapas.', 400, 'wrong_2fa')
  }
  await release(res) // senha (e 2FA) certos: não é falha

  if (novoEmail === u.email) throw new EmailChangeError('Este já é o e-mail da sua conta.', 400, 'same_email')
  const taken = await db.user.findUnique({ where: { email: novoEmail }, select: { id: true } })
  if (taken) throw new EmailChangeError('Este e-mail já está em uso.', 409, 'email_taken')

  await checkSendState(u.id)
  const now = Date.now()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await db.$transaction([
    db.verificationToken.deleteMany({ where: { OR: [{ identifier: { startsWith: codePrefix(u.id) } }, { identifier: tryId(u.id) }, { identifier: sentId(u.id), expires: { lte: new Date(now) } }] } }),
    db.verificationToken.create({ data: { identifier: codePrefix(u.id) + b64(novoEmail), token: hashCode(u.id, novoEmail, code), expires: new Date(now + CHANGE_CODE_TTL_MS) } }),
    db.verificationToken.create({ data: { identifier: sentId(u.id), token: randomBytes(12).toString('hex'), expires: new Date(now + HOUR_MS) } }),
  ])

  const sent = await sendMail({ to: novoEmail, ...emailChangeCodeEmail({ code, nome: u.nome }) })
  if (!sent.ok) throw new EmailChangeError('Não foi possível enviar o e-mail agora. Tente de novo em instantes.', 502, 'send_failed', Math.ceil(CHANGE_COOLDOWN_MS / 1000))

  // Aviso ao e-mail ANTIGO (melhor esforço): quem é o dono de verdade fica sabendo e pode reagir antes da conclusão.
  void sendMail({ to: u.email, ...emailChangeNoticeEmail({ concluida: false, novoEmail: maskEmail(novoEmail), nome: u.nome }) }).catch(() => undefined)
  await audit({ organizationId: u.organizationId, userId: u.id, acao: 'email.change_requested', alvo: maskEmail(novoEmail) })
  return { retryAfter: Math.ceil(CHANGE_COOLDOWN_MS / 1000) }
}

/**
 * Confirma o código do endereço novo e troca o e-mail. Derruba todas as sessões (a tela faz logout em seguida) e avisa o e-mail antigo.
 */
export async function confirmEmailChange(userId: string, rawCode: string, ip: string): Promise<{ email: string }> {
  const rl = await consume('emailChange', { email: userId, ip })
  if (rl.blocked) throw new EmailChangeError('Muitas tentativas. Tente de novo em alguns minutos.', 429, 'rate_limited', rl.retryAfter)

  const u = await db.user.findUnique({ where: { id: userId }, select: userSelect })
  if (!u) throw new EmailChangeError('Usuário não encontrado.', 404, 'not_found')
  const row = await db.verificationToken.findFirst({ where: { identifier: { startsWith: codePrefix(u.id) } } })
  if (!row || row.expires.getTime() < Date.now()) throw new EmailChangeError('Este código expirou. Peça um novo.', 400, 'expired')
  const novoEmail = unb64(row.identifier.slice(codePrefix(u.id).length))

  // Cada chamada gasta uma tentativa ANTES de comparar (vale sob concorrência).
  await db.verificationToken.create({ data: { identifier: tryId(u.id), token: randomBytes(12).toString('hex'), expires: row.expires } })
  const used = await db.verificationToken.count({ where: { identifier: tryId(u.id) } })
  const lock = async () => {
    await db.verificationToken.deleteMany({ where: { identifier: { in: [row.identifier, tryId(u.id)] } } })
    throw new EmailChangeError('Muitas tentativas. Peça um código novo.', 429, 'locked')
  }
  if (used > CHANGE_MAX_ATTEMPTS) return lock()

  const a = Buffer.from(hashCode(u.id, novoEmail, rawCode.trim()), 'hex')
  const b = Buffer.from(row.token, 'hex')
  if (!(a.length === b.length && timingSafeEqual(a, b))) {
    if (used >= CHANGE_MAX_ATTEMPTS) return lock()
    throw new EmailChangeError('Código incorreto. Confira e tente de novo.', 400, 'incorrect', undefined)
  }

  // Uso único: só segue quem de fato consumiu o código.
  const consumed = await db.verificationToken.deleteMany({ where: { identifier: row.identifier, token: row.token } })
  if (consumed.count !== 1) throw new EmailChangeError('Este código expirou. Peça um novo.', 400, 'expired')

  const antigo = u.email
  try {
    await db.$transaction([
      db.user.update({ where: { id: u.id }, data: { email: novoEmail, emailVerified: new Date(), sessionVersion: { increment: 1 } } }),
      // Links de redefinição de senha pendentes do endereço antigo (e códigos de verificação do antigo) deixam de valer.
      db.verificationToken.deleteMany({
        where: { OR: [{ identifier: `pwreset:${antigo}` }, { identifier: `pwreset:${novoEmail}` }, { identifier: { in: [`emailverify:${u.id}`, `emailverify-sent:${u.id}`, `emailverify-try:${u.id}`, tryId(u.id), sentId(u.id)] } }] },
      }),
    ])
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new EmailChangeError('Este e-mail já está em uso.', 409, 'email_taken')
    throw e
  }
  invalidateActiveSpace(u.id)
  forgetEmailGate(u.id)
  disconnectUser(u.id) // sockets abertos caem junto com as sessões
  void sendMail({ to: antigo, ...emailChangeNoticeEmail({ concluida: true, novoEmail: maskEmail(novoEmail), nome: u.nome }) }).catch(() => undefined)
  await audit({ organizationId: u.organizationId, userId: u.id, acao: 'email.changed', alvo: maskEmail(novoEmail) })
  return { email: novoEmail }
}

/** Cancela um pedido pendente (nada mudou no usuário). */
export async function cancelEmailChange(userId: string): Promise<void> {
  await db.verificationToken.deleteMany({ where: { OR: [{ identifier: { startsWith: codePrefix(userId) } }, { identifier: tryId(userId) }] } })
}
