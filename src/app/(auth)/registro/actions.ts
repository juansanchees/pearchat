'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { z } from 'zod'
import { signIn } from '@/auth'
import { db } from '@/lib/db'
import { registerAccount } from '@/server/auth/register'
import { issueEmailCode } from '@/server/mail/email-verification'
import { mailConfigured } from '@/server/mail/send'
import { clientIpFromHeaders } from '@/server/security/hash'
import { makeSessionCookieNonPersistent, type AuthFormState } from '../_lib/session-cookie'

// O telefone (WhatsApp) do formulário ainda não tem coluna no banco: é validado no cliente e não é salvo.
const schema = z.object({
  empresa: z.string().trim().max(120).optional(),
  nome: z.string().trim().min(2, 'Digite seu nome.').max(120, 'Use até 120 caracteres.'),
  email: z.string().trim().toLowerCase().email('Digite um e-mail válido.').max(200, 'Use até 200 caracteres.'),
  password: z.string().min(8, 'Use pelo menos 8 caracteres.').max(200, 'Use até 200 caracteres.'),
  termos: z.literal('true', { message: 'Aceite os termos para continuar.' }),
})

export async function registroAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = schema.safeParse({
    empresa: formData.get('empresa') || undefined,
    nome: formData.get('nome'),
    email: formData.get('email'),
    password: formData.get('password'),
    termos: formData.get('termos'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0])
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }
  const { empresa, nome, email, password } = parsed.data
  const remember = formData.get('lembrar') !== 'false'

  // Limites de cadastro (por IP, por e-mail e global) e criação da conta: ver src/server/auth/register.ts.
  const created = await registerAccount({ empresa, nome, email, password }, clientIpFromHeaders(headers()))
  if (!created.ok) {
    if (created.kind === 'email_taken') return { fieldErrors: { email: created.message } }
    return { error: created.message }
  }

  try {
    await signIn('credentials', { email, password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) return { error: 'Conta criada, mas não foi possível entrar. Tente fazer login.' }
    throw error
  }
  if (!remember) makeSessionCookieNonPersistent()
  // Com e-mail configurado, a conta nova confirma o e-mail (código de 6 dígitos) antes do onboarding.
  if (mailConfigured()) {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, nome: true } })
    if (user) await issueEmailCode(user).catch(() => undefined) // falha de envio: a tela permite reenviar
    redirect('/verificar-email')
  }
  // Sem e-mail configurado: conta nova segue para o onboarding; o login normal vai direto ao app.
  redirect('/bem-vindo')
}
