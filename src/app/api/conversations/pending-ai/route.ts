import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { countManualInFlight, countPendingByWindow, isJanela, JANELA_PADRAO, MAX_LOTE } from '@/server/engine/pending'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'

export const dynamic = 'force-dynamic'

// Conversas esperando resposta, por janela. Só dono/administrador (é a porta do lote). `janela` escolhe o `total`.
export async function GET(req: NextRequest) {
  const deny = await denyUnless('agent.manage')
  if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const j = req.nextUrl.searchParams.get('janela') ?? JANELA_PADRAO
  if (!isJanela(j)) return badRequest("Janela inválida (use '24h', '3d' ou '7d')")
  const [porJanela, emAndamento] = await Promise.all([countPendingByWindow(workspaceId), countManualInFlight(workspaceId)])
  return NextResponse.json({ total: porJanela[j], porJanela, emAndamento, maxPorExecucao: MAX_LOTE })
}
