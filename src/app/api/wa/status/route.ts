import { NextResponse } from 'next/server'
import { statusToKind } from '@/lib/mappers'
import { getApiSession } from '@/server/whatsapp/auth'
import { getProvider } from '@/server/whatsapp'
import { disableAutomations, getSession, setStatus, toStatusDTO } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const QR_TTL_MS = 20_000

export async function GET() {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { workspaceId } = session

  let row = await getSession(workspaceId)
  // Só a conexão rápida (Evolution) consulta o estado real; o mock e a oficial dependem de eventos/rotas próprias.
  if (row?.provider === 'RAPIDA' && process.env.WA_MOCK !== 'true' && row.status !== 'DESCONECTADO') {
    try {
      const provider = getProvider('rapida')
      const real = await provider.status(workspaceId)
      const current = statusToKind(row.status)
      if (real === 'conectado' && current !== 'conectado') {
        const numero = (await provider.fetchNumero?.(workspaceId).catch(() => undefined)) ?? row.numero
        row = await setStatus(workspaceId, 'conectado', { numero })
      } else if (real === 'desconectado' && current === 'conectado') {
        row = await setStatus(workspaceId, 'desconectado')
        await disableAutomations(workspaceId)
      } else if (current === 'aguardando_qr') {
        // Na Evolution "connecting" também aparece enquanto espera a leitura: continua mostrando o QR.
        const stale = !row.lastQrAt || Date.now() - row.lastQrAt.getTime() > QR_TTL_MS
        if (stale && provider.refreshQr) {
          const qr = await provider.refreshQr(workspaceId)
          if (qr) row = await setStatus(workspaceId, 'aguardando_qr', { qr })
        }
      }
    } catch (e) {
      console.error('[wa/status] falha ao consultar a Evolution:', e instanceof Error ? e.message : 'erro')
    }
  }
  return NextResponse.json(toStatusDTO(row))
}
