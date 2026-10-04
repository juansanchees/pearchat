import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { runTick } from '@/server/engine/scheduler'
import { sessionWorkspaceId, unauthorized } from '@/server/messages/api'

export const dynamic = 'force-dynamic'

// Roda um tick imediato do motor de automações e devolve o resumo. Só existe com WA_MOCK=true.
export async function POST() {
  const deny = await denyUnless('automations.toggle'); if (deny) return deny
  if (process.env.WA_MOCK !== 'true') return new NextResponse(null, { status: 404 })
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  return NextResponse.json(await runTick())
}
