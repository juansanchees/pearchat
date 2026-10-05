import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { AuthShell } from '@/components/auth/auth-shell'
import { VerificarForm } from '@/components/auth/verificar-form'
import { db } from '@/lib/db'
import { SessionUnavailableError } from '@/server/auth/availability'
import { hasActiveCode, sendState } from '@/server/mail/email-verification'
import { mailConfigured } from '@/server/mail/send'

export const metadata: Metadata = { title: 'PearChat · Confirmar e-mail' }
export const dynamic = 'force-dynamic'

export default async function VerificarEmailPage() {
  const session = await auth()
  if (session?.user?.unavailable) throw new SessionUnavailableError() // banco sem resposta: "tente de novo", sem ir ao /login
  const userId = session?.user?.userId
  if (!userId) redirect('/login')
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } })
  if (!user) redirect('/login')
  if (user.emailVerified) redirect('/bem-vindo')

  const configured = mailConfigured()
  const [active, state] = configured
    ? await Promise.all([hasActiveCode(userId), sendState(userId)])
    : [false, { retryAfter: 0 }]
  return (
    <AuthShell>
      <VerificarForm email={user.email} configured={configured} hasCode={active} initialCooldown={state.retryAfter} />
    </AuthShell>
  )
}
