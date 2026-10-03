import { NextResponse } from 'next/server'
import { getApiSession } from '@/server/whatsapp/auth'
import { startHistoryImport } from '@/server/whatsapp/history-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Inicia a importação do histórico em segundo plano. 409 se já estiver importando. */
export async function POST() {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const state = await startHistoryImport(session.workspaceId)
  switch (state) {
    case 'ok':
      return NextResponse.json({ status: 'importando' }, { status: 202 })
    case 'busy':
      return NextResponse.json({ error: 'A importação já está em andamento' }, { status: 409 })
    case 'unsupported':
      return NextResponse.json({ error: 'A importação não está disponível para esta conexão' }, { status: 400 })
    case 'desconectado':
      return NextResponse.json({ error: 'Conecte o WhatsApp para importar as conversas' }, { status: 400 })
    default:
      return NextResponse.json({ error: 'Não foi possível iniciar a importação' }, { status: 500 })
  }
}
