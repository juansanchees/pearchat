import { NextResponse } from 'next/server'
import { getApiSession } from '@/server/whatsapp/auth'
import { MOCK_NUMERO } from '@/server/whatsapp/mock'
import { getSession, setStatus, toStatusDTO } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Leitura do QR" simulada. Só existe com WA_MOCK=true.
export async function POST() {
  if (process.env.WA_MOCK !== 'true') return new NextResponse(null, { status: 404 })
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { workspaceId } = session

  const current = await getSession(workspaceId)
  if (!current?.provider) return NextResponse.json({ error: 'Escolha o tipo de conexão primeiro' }, { status: 409 })
  const row = await setStatus(workspaceId, 'conectado', { numero: current.numero ?? MOCK_NUMERO })
  return NextResponse.json(toStatusDTO(row))
}
