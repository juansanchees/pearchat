import type { Metadata } from 'next'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { Onboarding } from '@/components/auth/onboarding'
import { SessionUnavailableError } from '@/server/auth/availability'
import { needsEmailVerification } from '@/server/mail/email-verification'

export const metadata: Metadata = { title: 'PearChat · Primeiros passos' }

export default async function BemVindoPage() {
  const session = await auth()
  if (session?.user?.unavailable) throw new SessionUnavailableError() // banco sem resposta: "tente de novo", sem apagar a sessão
  if (session?.user?.userId && (await needsEmailVerification(session.user.userId))) redirect('/verificar-email')
  // Equipe: o onboarding do negócio é do dono; quem entrou por convite (administrador/atendente) vai direto ao app.
  if (session?.user?.userId && session.user.papel && session.user.papel !== 'owner') redirect('/')
  return <Onboarding nome={session?.user?.nome ?? session?.user?.name ?? ''} email={session?.user?.email ?? ''} />
}
