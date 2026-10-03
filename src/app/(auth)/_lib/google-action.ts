'use server'

import { redirect } from 'next/navigation'
import { signIn } from '@/auth'
import { googleLoginEnabled } from '@/lib/google-login'
import { safeRedirectPath } from '@/lib/safe-redirect'

// Inicia o OAuth do Google (redireciona para accounts.google.com). Conta nova cai em /bem-vindo (pages.newUser).
export async function googleAction(formData?: FormData) {
  if (!googleLoginEnabled()) redirect('/login?error=Configuration')
  await signIn('google', { redirectTo: safeRedirectPath(formData?.get('callbackUrl')) })
}
