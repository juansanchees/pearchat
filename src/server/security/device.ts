// Dispositivo confiável: cookie httpOnly `pc_dev` com um token assinado (HMAC-SHA256 com AUTH_SECRET, mesmo padrão do
// desafio do segundo fator em mfa.ts). Sem tabela nova: o token carrega a versão de sessão do usuário no momento em que
// foi emitido, então "Sair de todos os dispositivos", troca de senha, troca de e-mail e desativar o 2FA (que sobem
// `sessionVersion`) esquecem todos os dispositivos de uma vez.
//
// Um cookie por navegador; o token é de UM usuário (`u`). Num navegador usado por duas contas vale só o último que
// confirmou o código (a outra conta pede o código de novo).
import { createHmac, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { safeEqual } from './hash'

export const DEVICE_COOKIE = 'pc_dev'
export const DEVICE_TTL_MS = 180 * 24 * 3_600_000

type DevicePayload = { u: string; v: number; e: number; j: string }
const sign = (body: string) => createHmac('sha256', process.env.AUTH_SECRET ?? '').update(`trusted-device\u0000${body}`).digest('base64url')

export function issueDeviceToken(userId: string, sessionVersion: number, now = Date.now()): string {
  const p: DevicePayload = { u: userId, v: sessionVersion, e: now + DEVICE_TTL_MS, j: randomBytes(12).toString('base64url') }
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function readDeviceToken(token: string | null | undefined, now = Date.now()): DevicePayload | null {
  if (typeof token !== 'string' || !token || token.length > 1000) return null
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined) return null
  if (!safeEqual(mac, sign(body))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DevicePayload
    if (typeof p.u !== 'string' || typeof p.v !== 'number' || typeof p.e !== 'number' || p.e < now) return null
    return p
  } catch {
    return null
  }
}

/** Confiável: assinatura confere, é deste usuário, não expirou e a versão de sessão ainda é a mesma. */
export function isTrustedDevice(token: string | null | undefined, user: { id: string; sessionVersion: number }, now = Date.now()): boolean {
  const p = readDeviceToken(token, now)
  return !!p && p.u === user.id && p.v === user.sessionVersion
}

/** Token novo com a versão de sessão ATUAL do usuário (null se o usuário não existe). */
export async function deviceTokenFor(userId: string, now = Date.now()): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } })
  return u ? issueDeviceToken(userId, u.sessionVersion, now) : null
}

export const deviceCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: Math.floor(DEVICE_TTL_MS / 1000),
})

/** Lê o `pc_dev` de um cabeçalho Cookie cru (o `authorize` do Auth.js recebe só o Request). */
export function deviceTokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === DEVICE_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}
