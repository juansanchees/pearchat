import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { AcessoForm } from '@/components/auth/acesso-form'
import { loginCodeSendState } from '@/server/security/login-code'
import { MFA_COOKIE, readChallenge } from '@/server/security/mfa'

export const metadata: Metadata = { title: 'PearChat · Confirme o acesso', robots: { index: false } }
export const dynamic = 'force-dynamic'

// Só abre com um desafio válido (cookie httpOnly assinado). Sem ele, volta ao login. Aqui NÃO existe sessão.
// O tipo do desafio decide o modo: código do aplicativo autenticador ou código enviado por e-mail (dispositivo novo).
export default async function VerificarAcessoPage() {
  const token = cookies().get(MFA_COOKIE)?.value
  const ch = token ? readChallenge(token) : null
  if (!ch) redirect('/login')
  const cooldown = ch.t === 'email' ? (await loginCodeSendState(ch.u).catch(() => ({ retryAfter: 0 }))).retryAfter : 0
  return (
    <AuthShell>
      <AcessoForm method={ch.t} emailMasked={ch.m} initialCooldown={cooldown} />
    </AuthShell>
  )
}
