import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { AuthShell } from '@/components/auth/auth-shell'
import { ConviteForm, ConviteIndisponivel } from '@/components/auth/convite-form'
import { googleLoginEnabled } from '@/lib/google-login'
import { clientIpFromHeaders } from '@/server/security/hash'
import { previewInvite } from '@/server/team/service'

export const metadata: Metadata = { title: 'PearChat · Convite', robots: { index: false, follow: false } }

export const dynamic = 'force-dynamic'

// Página PÚBLICA do convite. Mostra só o nome da organização e o papel: nada de membros, espaços ou e-mails.
export default async function ConvitePage({ params }: { params: { token: string } }) {
  const preview = await previewInvite(params.token, clientIpFromHeaders(headers()))
  return (
    <AuthShell topText="Já tem conta?" topLabel="Entrar" topHref="/login">
      {preview.status === 'valido' ? (
        <ConviteForm token={params.token} organizacao={preview.organizacao} papel={preview.papel} googleEnabled={googleLoginEnabled()} />
      ) : (
        <ConviteIndisponivel status={preview.status} />
      )}
    </AuthShell>
  )
}
