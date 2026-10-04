'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { z } from 'zod'
import { signIn } from '@/auth'
import { clientIpFromHeaders } from '@/server/security/hash'
import { acceptInvite } from '@/server/team/service'
import type { AuthFormState } from '../../_lib/session-cookie'

const schema = z.object({
  nome: z.string().trim().min(2, 'Digite seu nome.').max(120),
  password: z.string().min(8, 'Use pelo menos 8 caracteres.').max(200),
})

// Aceita o convite: cria o usuário na organização que convidou (sem organização nova) e já entra.
export async function aceitarConviteAction(token: string, _prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = schema.safeParse({ nome: formData.get('nome'), password: formData.get('password') })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0])
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }
  const ip = clientIpFromHeaders(headers())
  const r = await acceptInvite(token, { nome: parsed.data.nome, senha: parsed.data.password }, ip)
  if (!r.ok) return { error: r.message }
  try {
    await signIn('credentials', { email: r.email, password: parsed.data.password, redirect: false })
  } catch (error) {
    if (error instanceof AuthError) redirect('/login')
    throw error
  }
  redirect('/whatsapp') // direto ao app (evita o salto extra pela página inicial do site)
}
