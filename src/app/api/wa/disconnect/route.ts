import { NextResponse } from 'next/server'
import { unauthorizedResponse } from '@/server/auth/availability'
import { auditWorkspace } from '@/server/audit/log'
import { denyUnless } from '@/server/auth/guard'
import { providerToKind } from '@/lib/mappers'
import { getApiSession } from '@/server/whatsapp/auth'
import { getProvider } from '@/server/whatsapp'
import { disableAutomations, getSession, setStatus, toStatusDTO } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const deny = await denyUnless('wa.manage'); if (deny) return deny
  const session = await getApiSession()
  if (!session) return unauthorizedResponse()
  const { workspaceId } = session

  const current = await getSession(workspaceId)
  if (current?.provider) {
    try {
      await getProvider(providerToKind(current.provider)).disconnect(workspaceId)
    } catch (e) {
      // Segue limpando o estado local mesmo que o provedor esteja fora do ar.
      console.error('[wa/disconnect] falha no provedor:', e instanceof Error ? e.message : 'erro')
    }
  }

  const row = await setStatus(workspaceId, 'desconectado', {
    provider: null,
    numero: null,
    qr: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    evolutionInstance: null,
    sessionData: null,
    resetHistory: true,
  })
  await disableAutomations(workspaceId)
  await auditWorkspace(workspaceId, session.userId, 'wa.disconnected')
  return NextResponse.json(toStatusDTO(row))
}
