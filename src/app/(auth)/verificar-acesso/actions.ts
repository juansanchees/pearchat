'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { MFA_COOKIE, readChallenge } from '@/server/security/mfa'
import { BLOCKED_MESSAGE } from '@/server/security/rate-limit'
import { makeSessionCookieNonPersistent } from '../_lib/session-cookie'

export type AccessState = { error?: string; expired?: boolean } | undefined

/** Segundo fator: o `authorize` confere desafio + código e só então o Auth.js cria a sessão. */
export async function verifyAccessAction(code: string): Promise<AccessState> {
  const challenge = cookies().get(MFA_COOKIE)?.value
  const payload = challenge ? readChallenge(challenge) : null
  if (!challenge || !payload) {
    cookies().delete(MFA_COOKIE)
    return { error: 'O tempo para confirmar acabou. Entre de novo.', expired: true }
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
  if (!payload.r) makeSessionCookieNonPersistent()
  redirect(safeRedirectPath(payload.cb))
}

function mapCode(s: string): AccessState {
  if (s.includes('rate_limited')) return { error: BLOCKED_MESSAGE }
  if (s.includes('challenge_expired')) {
    cookies().delete(MFA_COOKIE)
    return { error: 'O tempo para confirmar acabou. Entre de novo.', expired: true }
  }
  return { error: 'Código incorreto. Confira e tente de novo.' }
}

export async function cancelAccessAction() {
  cookies().delete(MFA_COOKIE)
  redirect('/login')
}
