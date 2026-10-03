import { exportContactsCsv, filenameForToday } from '@/server/contacts/export'
import { sessionWorkspaceId, unauthorized } from '@/server/contacts/api'

export const dynamic = 'force-dynamic'

export async function GET() {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const csv = await exportContactsCsv(workspaceId)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameForToday()}"`,
      'Cache-Control': 'no-store',
    },
  })
}
