import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { RedefinirForm } from '@/components/auth/redefinir-form'

export const metadata: Metadata = { title: 'PearChat · Criar senha nova', referrer: 'no-referrer' }

export default function RedefinirSenhaPage({ searchParams }: { searchParams: { token?: string | string[] } }) {
  const token = typeof searchParams.token === 'string' ? searchParams.token : undefined
  return (
    <AuthShell>
      <RedefinirForm token={token} />
    </AuthShell>
  )
}
