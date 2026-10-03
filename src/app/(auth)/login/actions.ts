'use server'

import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { makeSessionCookieNonPersistent, type AuthFormState } from '../_lib/session-cookie'

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const remember = formData.get('lembrar') !== 'false'
  try {
    const url = await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirect: false,
    })
    if (typeof url === 'string' && url.includes('error=')) return { error: 'E-mail ou senha incorretos.' }
  } catch (error) {
    if (error instanceof AuthError) return { error: 'E-mail ou senha incorretos.' }
    throw error
  }
  if (!remember) makeSessionCookieNonPersistent()
  redirect('/')
}
