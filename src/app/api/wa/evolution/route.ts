import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { handleEvolutionEvent } from '@/server/whatsapp/evolution-webhook'
import { inboxLog, processInboxRow, storeInbox } from '@/server/whatsapp/inbox'
import { normalizeEvolutionEvent } from '@/server/whatsapp/normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Teto do corpo: o histórico do pareamento chega em lotes grandes e, se a Evolution estiver configurada com base64 no
 * webhook (global ou de instância antiga), um vídeo de ~30 MB vira ~40 MB. 413 a Evolution não repete: o evento se perderia.
 * Fica fora do teto de 256 KB do middleware (matcher em src/middleware.ts).
 */
const MAX_BODY_BYTES = 40 * 1024 * 1024

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Webhook da Evolution API 2.3.7. Regra de durabilidade: mensagem, status, eco de envio e conexão só recebem 2xx DEPOIS
 * de gravados na caixa de entrada (WebhookInbox). Se a gravação falha, responde 503 e a Evolution reentrega (ela repete
 * 5xx/timeout até 10 vezes, de 5 s a 5 min: WEBHOOK_RETRY_*). Falha no PROCESSAMENTO (depois de gravado) responde 200:
 * a caixa de entrada repete com espera e o agendador drena o pendente (inclusive após queda/deploy).
 * QR e histórico do pareamento não passam pela caixa: QR é efêmero e o histórico tem passagens próprias de reimportação.
 */
export async function POST(req: Request) {
  const expected = process.env.EVOLUTION_API_KEY
  const got = req.headers.get('apikey')
  if (!expected || !got || !safeEqual(got, expected)) return new NextResponse(null, { status: 401 })

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })
  const raw = await req.text().catch(() => null)
  if (raw === null) return new NextResponse(null, { status: 400 })
  if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })
  let json: unknown = null
  try {
    json = JSON.parse(raw)
  } catch {
    return new NextResponse(null, { status: 200 }) // não é JSON: nada a fazer (e 4xx a Evolution não repete mesmo)
  }
  const event = normalizeEvolutionEvent(json)
  if (event.kind === 'ignored') return new NextResponse(null, { status: 200 })

  if (event.kind === 'qr' || event.kind === 'history') {
    try {
      await handleEvolutionEvent(event, { receivedAt: new Date() })
    } catch (e) {
      inboxLog('warn', 'evento-direto-falhou', { provider: 'evolution', tipo: event.kind, erro: e instanceof Error ? e.message.slice(0, 200) : 'erro' })
    }
    return new NextResponse(null, { status: 200 })
  }

  let stored: Awaited<ReturnType<typeof storeInbox>>
  try {
    stored = await storeInbox('evolution', raw)
  } catch (e) {
    // Nada foi gravado: 5xx para a Evolution reentregar.
    inboxLog('error', 'gravacao-falhou', { provider: 'evolution', tipo: event.kind, erro: e instanceof Error ? e.message.slice(0, 200) : 'erro' })
    return new NextResponse(null, { status: 503 })
  }
  // Processa já (ordem natural dos eventos); falha aqui não perde nada: fica na caixa e é repetida.
  if (!stored.done) {
    await processInboxRow(stored.id).catch((e) =>
      inboxLog('warn', 'processamento-adiado', { provider: 'evolution', id: stored.id, erro: e instanceof Error ? e.message.slice(0, 200) : 'erro' }),
    )
  }
  return new NextResponse(null, { status: 200 })
}
