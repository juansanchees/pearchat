'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { clientIpFromHeaders } from '@/server/security/hash'
import { DEVICE_COOKIE } from '@/server/security/device'
import { challengeTtlMs, MFA_COOKIE } from '@/server/security/mfa'
import { primaryLogin } from '@/server/security/login'
import { BLOCKED_MESSAGE } from '@/server/security/rate-limit'
import { makeSessionCookieNonPersistent, type AuthFormState } from '../_lib/session-cookie'

// Mensagem única para e-mail inexistente, senha errada e conta sem senha (não revela quais e-mails existem).
const INVALID = 'E-mail ou senha incorretos.'

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const remember = formData.get('lembrar') !== 'false'
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const callbackUrl = safeRedirectPath(formData.get('callbackUrl'))
  const ip = clientIpFromHeaders(headers())

  // Primeiro fator (com limite de tentativas). Com 2FA ativo, ou de um dispositivo novo com e-mail configurado (o código
  // já foi enviado), NÃO se cria sessão: só um desafio assinado, e a tela /verificar-acesso pede o código.
  const deviceToken = cookies().get(DEVICE_COOKIE)?.value ?? null
  const first = await primaryLogin(email, password, ip, { remember, callbackUrl, deviceToken })
  if (first.kind === 'blocked') return { error: BLOCKED_MESSAGE }
  if (first.kind === 'invalid') return { error: INVALID }
  if (first.kind === 'mfa') {
    cookies().set(MFA_COOKIE, first.challenge, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: Math.floor(challengeTtlMs(first.method) / 1000),
    })
    redirect('/verificar-acesso')
  }

  // Sem segundo passo: o `authorize` do Auth.js confere de novo (é o único ponto que emite sessão) e cria o cookie.
  try {
    const url = await signIn('credentials', { email, password, redirect: false })
    if (typeof url === 'string' && url.includes('error=')) return { error: messageFor(url) }
  } catch (error) {
    if (error instanceof AuthError) return { error: messageFor((error as { code?: string }).code ?? '') }
    throw error
  }
  if (!remember) makeSessionCookieNonPersistent()
  redirect(callbackUrl)
}

// "second_factor" aqui só acontece numa corrida (ex.: "sair de todos os dispositivos" entre as duas conferências).
function messageFor(s: string): string {
  if (s.includes('rate_limited')) return BLOCKED_MESSAGE
  if (s.includes('second_factor')) return 'Precisamos confirmar este acesso. Entre de novo.'
  return INVALID
}
