import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { VerificarForm } from '@/components/auth/verificar-form'

export const metadata: Metadata = { title: 'PearChat · Confirmar e-mail' }

export default function VerificarEmailPage({ searchParams }: { searchParams: { email?: string | string[] } }) {
  const email = typeof searchParams.email === 'string' ? searchParams.email.slice(0, 120) : undefined
  return (
    <AuthShell>
      <VerificarForm email={email} />
    </AuthShell>
  )
}
