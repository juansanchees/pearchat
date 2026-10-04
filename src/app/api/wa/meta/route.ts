import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { enqueueMetaPayload } from '@/server/whatsapp/meta-webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024 * 1024

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Desafio de verificação do webhook (configurado no painel do app na Meta: hub.mode, hub.verify_token, hub.challenge).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = process.env.META_VERIFY_TOKEN
  const challenge = url.searchParams.get('hub.challenge')
  if (token && url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(url.searchParams.get('hub.verify_token') ?? '', token) && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse(null, { status: 403 })
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo cru, segredo do app). Qualquer formato estranho é recusado sem lançar. */
function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret || !header || !/^sha256=[0-9a-fA-F]{64}$/.test(header)) return false
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest()
  const got = Buffer.from(header.slice('sha256='.length), 'hex')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

export async function POST(req: Request) {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 })
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES || !validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse(null, { status: 401 })
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  // Responde 200 já: a Meta reenvia por até 7 dias se demorar ou falhar. O processamento segue em fila (ordem preservada)
  // e as duplicatas são absorvidas por idempotência (id da mensagem).
  void enqueueMetaPayload(json)
  return new NextResponse(null, { status: 200 })
}
