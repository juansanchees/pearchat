import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { BodyTooLargeError, readTextLimited } from '@/server/http/body'
import { inboxLog, kickInboxRow, storeInbox } from '@/server/whatsapp/inbox'

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
  // Leitura em streaming com teto: corpo chunked (sem content-length) não enche a memória antes da assinatura.
  let raw: string
  try {
    raw = await readTextLimited(req, MAX_BODY_BYTES)
  } catch (e) {
    return new NextResponse(null, { status: e instanceof BodyTooLargeError ? 413 : 400 })
  }
  if (raw.length > MAX_BODY_BYTES || !validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse(null, { status: 401 })
  }
  try {
    JSON.parse(raw)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  // Só responde 200 DEPOIS de gravar o evento na caixa de entrada: se o processo cair em seguida, o agendador drena.
  // Falha ao gravar = 5xx e a Meta reentrega (por até 7 dias). Reentrega idêntica não duplica (mesmo corpo).
  let stored: Awaited<ReturnType<typeof storeInbox>>
  try {
    stored = await storeInbox('meta', raw)
  } catch (e) {
    inboxLog('error', 'gravacao-falhou', { provider: 'meta', erro: e instanceof Error ? e.message.slice(0, 200) : 'erro' })
    return new NextResponse(null, { status: 503 })
  }
  // Processamento em segundo plano, em ordem de chegada (a Meta pede resposta rápida).
  if (!stored.done) kickInboxRow(stored.id)
  return new NextResponse(null, { status: 200 })
}
