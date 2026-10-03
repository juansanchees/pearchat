import { NextResponse } from 'next/server'
import { getApiSession } from '@/server/whatsapp/auth'
import { getHistoryDTO } from '@/server/whatsapp/history-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Andamento da importação do histórico do WhatsApp (status e contagens). */
export async function GET() {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  return NextResponse.json(await getHistoryDTO(session.workspaceId))
}
