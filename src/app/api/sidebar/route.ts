import { NextResponse } from 'next/server'
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
  const [contatos, fuQueue, campanhas] = await Promise.all([
    db.contact.count({ where: { workspaceId } }),
    countFollowUpQueue(workspaceId),
    listCampaigns(workspaceId),
  ])
  return NextResponse.json({ contatos, fuQueue, campanhas } satisfies SidebarSummary)
}
