import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isValidId, notFound, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { getWindowInfo } from '@/server/messages/send-template'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// Janela de 24 h da conversa (API oficial): aberta/fechada e, se fechada, os modelos aprovados para responder.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()
  const info = await getWindowInfo(workspaceId, params.id)
  if (!info) return notFound()
  return NextResponse.json(info)
}
