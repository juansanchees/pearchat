'use server'

import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { z } from 'zod'
import { signIn } from '@/auth'
import { db } from '@/lib/db'
import { newOrganizationBilling } from '@/server/billing/config'
import { issueEmailCode } from '@/server/mail/email-verification'
import { mailConfigured } from '@/server/mail/send'
import { makeSessionCookieNonPersistent, type AuthFormState } from '../_lib/session-cookie'

// O telefone (WhatsApp) do formulário ainda não tem coluna no banco: é validado no cliente e não é salvo.
const schema = z.object({
  empresa: z.string().trim().max(120).optional(),
  nome: z.string().trim().min(2, 'Digite seu nome.'),
  email: z.string().trim().toLowerCase().email('Digite um e-mail válido.'),
  password: z.string().min(8, 'Use pelo menos 8 caracteres.'),
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
  const nomeEmpresa = empresa && empresa.length >= 2 ? empresa : `Negócio de ${nome.split(/\s+/)[0]}`

  const exists = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (exists) return { fieldErrors: { email: 'Já existe uma conta com esse e-mail.' } }

  const passwordHash = await bcrypt.hash(password, 10)
  try {
    await db.$transaction(async (tx) => {
      // Conta = Organization (plano/assinatura) + primeiro espaço (WhatsApp) + usuário dono.
      const org = await tx.organization.create({ data: { nome: nomeEmpresa, ...newOrganizationBilling() } })
      const workspace = await tx.workspace.create({ data: { nome: nomeEmpresa, organizationId: org.id, plano: org.plano } })
      await tx.user.create({
        data: { workspaceId: workspace.id, organizationId: org.id, nome, email, passwordHash, papel: 'owner' },
      })
    })
  } catch (e) {
    // Dois cadastros simultâneos com o mesmo e-mail: a transação inteira é desfeita.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { fieldErrors: { email: 'Já existe uma conta com esse e-mail.' } }
    }
    throw e
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
    const created = await db.user.findUnique({ where: { email }, select: { id: true, email: true, nome: true } })
    if (created) await issueEmailCode(created).catch(() => undefined) // falha de envio: a tela permite reenviar
    redirect('/verificar-email')
  }
  // Sem e-mail configurado: conta nova segue para o onboarding; o login normal vai direto ao app.
  redirect('/bem-vindo')
}
