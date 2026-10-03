import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import { getApiSession } from '@/server/whatsapp/auth'
import { getProvider } from '@/server/whatsapp'
import { getSession, setStatus, toStatusDTO } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
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
  })
  await Promise.all([
    db.aiAgent.updateMany({ where: { workspaceId }, data: { enabled: false } }),
    db.followUpRule.updateMany({ where: { workspaceId }, data: { enabled: false } }),
  ])
  return NextResponse.json(toStatusDTO(row))
}
