import { NextResponse } from 'next/server'
import { invalidateActiveSpace } from '@/server/spaces/org'
import { apiSession, unauthorized } from '@/server/settings/http'
import { revokeAllSessions } from '@/server/security/mfa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** "Sair de todos os dispositivos": sobe a versão de sessão; todo JWT emitido antes deixa de valer (inclusive este). */
export async function DELETE() {
  const s = await apiSession()
  if (!s) return unauthorized()
  await revokeAllSessions(s.userId)
  invalidateActiveSpace(s.userId)
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
