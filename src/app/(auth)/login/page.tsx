import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = { title: 'PearChat · Entrar' }

export default function LoginPage() {
  return (
    <AuthShell topText="Ainda não tem conta?" topLabel="Criar conta grátis" topHref="/registro">
      <LoginForm />
    </AuthShell>
  )
}
