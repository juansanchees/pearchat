import type { Metadata } from 'next'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { Onboarding } from '@/components/auth/onboarding'
import { needsEmailVerification } from '@/server/mail/email-verification'

export const metadata: Metadata = { title: 'PearChat · Primeiros passos' }

export default async function BemVindoPage() {
  const session = await auth()
  if (session?.user?.userId && (await needsEmailVerification(session.user.userId))) redirect('/verificar-email')
  return <Onboarding nome={session?.user?.nome ?? session?.user?.name ?? ''} email={session?.user?.email ?? ''} />
}
