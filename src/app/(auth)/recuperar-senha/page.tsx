import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { RecuperarForm } from '@/components/auth/recuperar-form'

export const metadata: Metadata = { title: 'PearChat · Recuperar senha' }

export default function RecuperarSenhaPage() {
  return (
    <AuthShell>
      <RecuperarForm />
    </AuthShell>
  )
}
