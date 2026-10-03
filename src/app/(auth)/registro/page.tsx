import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { RegistroForm } from '@/components/auth/registro-form'

export const metadata: Metadata = { title: 'PearChat · Criar conta' }

export default function RegistroPage() {
  return (
    <AuthShell topText="Já tem conta?" topLabel="Entrar" topHref="/login">
      <RegistroForm />
    </AuthShell>
  )
}
