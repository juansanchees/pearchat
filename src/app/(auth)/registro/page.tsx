import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { RegistroForm } from '@/components/auth/registro-form'
import { googleLoginEnabled } from '@/lib/google-login'

export const metadata: Metadata = { title: 'PearChat · Criar conta' }

export const dynamic = 'force-dynamic'

export default function RegistroPage() {
  return (
    <AuthShell topText="Já tem conta?" topLabel="Entrar" topHref="/login">
      <RegistroForm googleEnabled={googleLoginEnabled()} />
    </AuthShell>
  )
}
