import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { googleLoginEnabled, loginErrorMessage } from '@/lib/google-login'

export const metadata: Metadata = { title: 'PearChat · Entrar' }
// Lê as credenciais do Google em tempo de execução (não no build).
export const dynamic = 'force-dynamic'

export default function LoginPage({ searchParams }: { searchParams: { error?: string | string[] } }) {
  const code = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error
  return (
    <AuthShell topText="Ainda não tem conta?" topLabel="Criar conta grátis" topHref="/registro">
      <LoginForm googleEnabled={googleLoginEnabled()} oauthError={loginErrorMessage(code)} />
    </AuthShell>
  )
}
