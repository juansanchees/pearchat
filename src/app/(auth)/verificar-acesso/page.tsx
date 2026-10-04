import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { AcessoForm } from '@/components/auth/acesso-form'
import { MFA_COOKIE, readChallenge } from '@/server/security/mfa'

export const metadata: Metadata = { title: 'PearChat · Verificação em duas etapas', robots: { index: false } }
export const dynamic = 'force-dynamic'

// Só abre com um desafio válido (cookie httpOnly assinado, 5 min). Sem ele, volta ao login. Aqui NÃO existe sessão.
export default function VerificarAcessoPage() {
  const token = cookies().get(MFA_COOKIE)?.value
  if (!token || !readChallenge(token)) redirect('/login')
  return (
    <AuthShell>
      <AcessoForm />
    </AuthShell>
  )
}
