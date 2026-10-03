import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { statusToKind } from '@/lib/mappers'
import { ingestInboundMessage, updateMessageStatus } from '@/server/messages/ingest'
import { normalizeEvolutionEvent } from '@/server/whatsapp/normalize'
import { getProvider } from '@/server/whatsapp'
import { setStatus } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export async function POST(req: Request) {
  const expected = process.env.EVOLUTION_API_KEY
  const got = req.headers.get('apikey')
  if (!expected || !got || !safeEqual(got, expected)) return new NextResponse(null, { status: 401 })

  const json: unknown = await req.json().catch(() => null)
  const event = normalizeEvolutionEvent(json)
  if (event.kind === 'ignored') return new NextResponse(null, { status: 200 })

  try {
    const session = await db.whatsAppSession.findFirst({
      where: { evolutionInstance: event.instance },
      select: { workspaceId: true, status: true, numero: true },
    })
    if (!session) return new NextResponse(null, { status: 200 })
    const { workspaceId } = session
    const current = statusToKind(session.status)

    switch (event.kind) {
      case 'qr':
        if (current !== 'conectado') await setStatus(workspaceId, 'aguardando_qr', { qr: event.qr })
        break
      case 'connection':
        if (event.status === 'conectado') {
          const numero = await getProvider('rapida')
            .fetchNumero?.(workspaceId)
            .catch(() => undefined)
          await setStatus(workspaceId, 'conectado', { numero: numero ?? session.numero })
        } else if (event.status === 'desconectado') {
          // Enquanto espera a leitura do QR a Evolution também reporta "close": não derruba a tela do QR.
          if (current === 'conectado' || current === 'conectando') await setStatus(workspaceId, 'desconectado')
        } else if (current !== 'aguardando_qr' && current !== 'conectado') {
          // "connecting" durante a espera do QR é ambíguo: mantém aguardando_qr.
          await setStatus(workspaceId, 'conectando')
        }
        break
      case 'messages':
        for (const m of event.inbound) {
          await ingestInboundMessage({
            workspaceId,
            from: m.from,
            nome: m.nome,
            body: m.body,
            providerMessageId: m.providerMessageId,
            timestamp: m.timestamp,
          })
        }
        break
      case 'status':
        for (const u of event.updates) {
          await updateMessageStatus({ workspaceId, providerMessageId: u.providerMessageId, status: u.status })
        }
        break
    }
  } catch (e) {
    console.error('[wa/evolution] falha ao processar evento:', e instanceof Error ? e.message : 'erro')
  }
  return new NextResponse(null, { status: 200 })
}
