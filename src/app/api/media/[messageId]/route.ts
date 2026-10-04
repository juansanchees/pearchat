import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isValidId, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { contentDisposition, extForMime, isInlineSafe, kindOfMime, normalizeMime, sanitizeFileName } from '@/server/media/mime'
import { getMediaStore, isValidMediaKey } from '@/server/media/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

/** "bytes=a-b" | "bytes=a-" | "bytes=-n". null = sem Range (ou formato que ignoramos); 'invalid' = 416. */
function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!m) return null
  const [, a = '', b = ''] = m
  if (a === '' && b === '') return 'invalid'
  let start: number
  let end: number
  if (a === '') {
    const n = Number(b)
    if (!Number.isSafeInteger(n) || n <= 0) return 'invalid'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid'
  return { start, end }
}

// Arquivo da mensagem: só com sessão e só do workspace da sessão. O Content-Type vem do REGISTRO (validado pela
// assinatura do arquivo), nunca do cliente; tipos ativos (HTML, SVG, PDF, documentos) nunca saem como "inline".
export async function GET(req: Request, { params }: { params: { messageId: string } }) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.messageId)) return notFound()

  const m = await db.message.findFirst({
    where: { id: params.messageId, conversation: { workspaceId } },
    select: { mediaKey: true, mediaMime: true, mediaName: true, mediaStatus: true },
  })
  if (!m || m.mediaStatus !== 'ok' || !m.mediaKey || !isValidMediaKey(m.mediaKey) || !m.mediaKey.startsWith(`${workspaceId}/`)) return notFound()

  // Só tipos da lista saem com o próprio Content-Type; qualquer outra coisa (registro adulterado) vai como binário genérico.
  const mime = kindOfMime(m.mediaMime ?? '') ? normalizeMime(m.mediaMime) : 'application/octet-stream'
  const wantsDownload = new URL(req.url).searchParams.get('download') === '1'
  const disposition = !wantsDownload && isInlineSafe(mime) ? 'inline' : 'attachment'
  const fileName = sanitizeFileName(m.mediaName, extForMime(mime))

  const store = getMediaStore()
  const head = await store.get(m.mediaKey)
  if (!head) return notFound()
  head.stream.destroy()
  const size = head.size

  const headers: Record<string, string> = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': contentDisposition(disposition, fileName),
    'Cache-Control': 'private, max-age=3600',
    'Accept-Ranges': 'bytes',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  }

  const range = parseRange(req.headers.get('range'), size)
  if (range === 'invalid') return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })

  const part = await store.get(m.mediaKey, range ?? undefined)
  if (!part) return notFound()
  const body = Readable.toWeb(part.stream) as unknown as ReadableStream
  if (range) {
    return new NextResponse(body, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${part.start}-${part.end}/${size}`, 'Content-Length': String(part.end - part.start + 1) },
    })
  }
  return new NextResponse(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}
