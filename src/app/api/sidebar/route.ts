import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { can } from '@/server/auth/permissions'
import { db } from '@/lib/db'
import { listCampaigns } from '@/server/campaigns/service'
import { countFollowUpQueue } from '@/server/followup/service'
import { sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import type { CampaignDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export interface SidebarSummary {
  contatos: number
  fuQueue: number
  campanhas: CampaignDTO[]
}

/** GET /api/sidebar -> números do menu lateral (contatos salvos, fila do follow-up, campanhas). */
export async function GET() {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  const session = await auth()
  const manager = can(session?.user, 'campaigns.manage') // Equipe: atendente não vê disparos nem fila do follow-up
  const [contatos, fuQueue, campanhas] = await Promise.all([
    db.contact.count({ where: { workspaceId } }),
    manager ? countFollowUpQueue(workspaceId) : Promise.resolve(0),
    manager ? listCampaigns(workspaceId) : Promise.resolve([]),
  ])
  return NextResponse.json({ contatos, fuQueue, campanhas } satisfies SidebarSummary)
}
