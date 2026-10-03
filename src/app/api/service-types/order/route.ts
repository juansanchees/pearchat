import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { listActiveServiceTypes, toServiceTypeDto } from '@/server/calendar/service-types'
import type { ServiceTypeListResponse } from '@/server/calendar/types'

export const dynamic = 'force-dynamic'

const schema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) }).strict()

/** PUT /api/service-types/order { ids } -> nova ordem (índice no array). Ignora ids de outros workspaces. */
export async function PUT(req: Request) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  const parsed = schema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Informe a lista de ids na nova ordem')
  const ids = Array.from(new Set(parsed.data.ids))

  const own = await db.serviceType.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } })
  const ownIds = new Set(own.map((o) => o.id))
  const ordered = ids.filter((i) => ownIds.has(i))
  await db.$transaction(ordered.map((id, i) => db.serviceType.update({ where: { id }, data: { ordem: i } })))
  const rows = await listActiveServiceTypes(workspaceId)
  return NextResponse.json({ tipos: rows.map(toServiceTypeDto) } satisfies ServiceTypeListResponse)
}
