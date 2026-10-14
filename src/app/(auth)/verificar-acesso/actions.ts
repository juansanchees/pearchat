'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { db } from '@/lib/db'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { DEVICE_COOKIE, deviceCookieOptions, deviceTokenFor } from '@/server/security/device'
import { clientIpFromHeaders } from '@/server/security/hash'
import { issueLoginCode } from '@/server/security/login-code'
import { challengeTtlMs, issueChallenge, MFA_COOKIE, readChallenge } from '@/server/security/mfa'
import { BLOCKED_MESSAGE, consume } from '@/server/security/rate-limit'
import { makeSessionCookieNonPersistent } from '../_lib/session-cookie'

export type AccessState = { error?: string; expired?: boolean; locked?: boolean } | undefined

const EXPIRED = 'O tempo para confirmar acabou. Entre de novo.'

/** Segundo passo: o `authorize` confere desafio + código e só então o Auth.js cria a sessão. */
export async function verifyAccessAction(code: string): Promise<AccessState> {
  const challenge = cookies().get(MFA_COOKIE)?.value
  const payload = challenge ? readChallenge(challenge) : null
  if (!challenge || !payload) {
    cookies().delete(MFA_COOKIE)
    return { error: EXPIRED, expired: true }
  }
  const trimmed = String(code ?? '').trim().slice(0, 40)
  if (!trimmed) return { error: 'Digite o código.' }

  try {
    const url = await signIn('credentials', { challenge, code: trimmed, redirect: false })
    if (typeof url === 'string' && url.includes('error=')) return mapCode(url)
  } catch (error) {
    if (error instanceof AuthError) return mapCode((error as { code?: string }).code ?? '')
    throw error
  }
  cookies().delete(MFA_COOKIE)
  // Este navegador passa a ser um dispositivo confiável da conta (vale até "Sair de todos os dispositivos").
  try {
    const token = await deviceTokenFor(payload.u)
    if (token) cookies().set(DEVICE_COOKIE, token, deviceCookieOptions())
  } catch {
    // melhor esforço: sem o cookie, o próximo login só pede o código de novo
  }
  if (!payload.r) makeSessionCookieNonPersistent()
  redirect(safeRedirectPath(payload.cb))
}

function mapCode(s: string): AccessState {
  if (s.includes('rate_limited')) return { error: BLOCKED_MESSAGE }
  if (s.includes('challenge_expired')) {
    cookies().delete(MFA_COOKIE)
    return { error: EXPIRED, expired: true }
  }
  if (s.includes('code_locked')) return { error: 'Este código não vale mais. Peça outro em "Reenviar código".', locked: true }
  return { error: 'Código incorreto. Confira e tente de novo.' }
}

export type ResendState = { ok?: boolean; error?: string; expired?: boolean; retryAfter?: number }

/** "Reenviar código" (só no modo e-mail): novo código (60 s entre envios, 5 por hora) e o prazo do desafio renovado. */
export async function resendAccessCodeAction(): Promise<ResendState> {
  const challenge = cookies().get(MFA_COOKIE)?.value
  const payload = challenge ? readChallenge(challenge) : null
  if (!payload) {
    cookies().delete(MFA_COOKIE)
    return { error: EXPIRED, expired: true }
  }
  if (payload.t !== 'email') return { error: 'Use o código do aplicativo autenticador.' }
  const user = await db.user.findUnique({ where: { id: payload.u }, select: { id: true, email: true, nome: true, desativadoEm: true, totpEnabledAt: true } })
  if (!user || user.desativadoEm || user.totpEnabledAt) {
    cookies().delete(MFA_COOKIE)
    return { error: EXPIRED, expired: true }
  }
  const limit = await consume('emailSend', { ip: clientIpFromHeaders(headers()) })
  if (limit.blocked) return { error: BLOCKED_MESSAGE, retryAfter: limit.retryAfter }

  const r = await issueLoginCode(user)
  if (!r.ok) {
    return {
      error: r.reason === 'hourly' ? 'Você pediu muitos códigos. Tente de novo mais tarde.' : 'Aguarde um pouco para pedir outro código.',
      retryAfter: r.retryAfter,
    }
  }
  // O código novo vale 10 min: o desafio acompanha (mesmos dados, prazo novo).
  const fresh = issueChallenge(user.id, { remember: payload.r, callbackUrl: payload.cb, method: 'email', emailMasked: payload.m })
  cookies().set(MFA_COOKIE, fresh, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(challengeTtlMs('email') / 1000),
  })
  if (!r.sent) return { error: 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.', retryAfter: r.retryAfter }
  return { ok: true, retryAfter: r.retryAfter }
}

export async function cancelAccessAction() {
  cookies().delete(MFA_COOKIE)
  redirect('/login')
}
