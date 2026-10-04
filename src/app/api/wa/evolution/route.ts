import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { statusToKind } from '@/lib/mappers'
import { ingestInboundMessage, ingestOutboundFromPhone, updateMessageStatus } from '@/server/messages/ingest'
import { queueHistoryMessages } from '@/server/whatsapp/history-import'
import { normalizeEvolutionEvent } from '@/server/whatsapp/normalize'
import { getProvider } from '@/server/whatsapp'
import { disableAutomations, setStatus } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resposta do celular mais velha que isto não assume a conversa (é tratada como histórico). */
const OUTBOUND_TAKEOVER_MAX_AGE_MS = 10 * 60_000

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
      select: { workspaceId: true, status: true, numero: true, connectedAt: true },
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
          if (current === 'conectado' || current === 'conectando') {
            await setStatus(workspaceId, 'desconectado')
            await disableAutomations(workspaceId)
          }
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
        // Respostas dadas pelo celular do dono. Só assumem a conversa se forem recentes e posteriores à conexão
        // (mensagens antigas que chegam por aqui são histórico: gravadas como importadas, sem assumir).
        for (const m of event.outbound) {
          const age = Date.now() - m.timestamp.getTime()
          const afterConnect = !session.connectedAt || m.timestamp.getTime() >= session.connectedAt.getTime() - 60_000
          await ingestOutboundFromPhone({
            workspaceId,
            to: m.to,
            body: m.body,
            providerMessageId: m.providerMessageId,
            timestamp: m.timestamp,
            takeOver: age < OUTBOUND_TAKEOVER_MAX_AGE_MS && afterConnect,
          })
        }
        break
      case 'history':
        // Histórico do pareamento: grava em lote, sem acionar IA/follow-up/campanhas.
        queueHistoryMessages(workspaceId, event.messages)
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
