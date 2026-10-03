import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ingestInboundMessage, updateMessageStatus } from '@/server/messages/ingest'
import { normalizeMetaPayload } from '@/server/whatsapp/normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Desafio de verificação do webhook (configurado no painel do app na Meta).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = process.env.META_VERIFY_TOKEN
  const challenge = url.searchParams.get('hub.challenge')
  if (token && url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(url.searchParams.get('hub.verify_token') ?? '', token) && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse(null, { status: 403 })
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret || !header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest()
  const got = Buffer.from(header.slice('sha256='.length), 'hex')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

export async function POST(req: Request) {
  const raw = await req.text()
  if (!validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse(null, { status: 401 })
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  // Sempre 200 depois da assinatura válida: a Meta reenvia em caso de erro e não queremos tempestade de retentativas.
  for (const batch of normalizeMetaPayload(json)) {
    try {
      const session = await db.whatsAppSession.findFirst({
        where: { metaPhoneNumberId: batch.phoneNumberId },
        select: { workspaceId: true },
      })
      if (!session) continue
      const { workspaceId } = session
      for (const m of batch.inbound) {
        await ingestInboundMessage({
          workspaceId,
          from: m.from,
          nome: m.nome,
          body: m.body,
          providerMessageId: m.providerMessageId,
          timestamp: m.timestamp,
        })
      }
      for (const s of batch.statuses) {
        await updateMessageStatus({ workspaceId, providerMessageId: s.providerMessageId, status: s.status })
      }
    } catch (e) {
      console.error('[wa/meta] falha ao processar lote:', e instanceof Error ? e.message : 'erro')
    }
  }
  return new NextResponse(null, { status: 200 })
}
