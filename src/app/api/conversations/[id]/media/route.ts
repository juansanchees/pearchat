import { NextResponse } from 'next/server'
import { isValidId, notFound, sessionIds, unauthorized } from '@/server/messages/api'
import { MAX_OUTBOUND_BYTES } from '@/server/media/mime'
import { SendError } from '@/server/messages/send'
import { sendUserMedia } from '@/server/messages/send-media'
import { denyIfEmailUnverified } from '@/server/auth/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Margem do multipart (cabeçalhos das partes, legenda) acima do limite do arquivo.
const BODY_SLACK = 256 * 1024

/** Lê o corpo da requisição até `max` bytes; passou disso, devolve null (sem carregar o resto). */
async function readLimited(req: Request, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return null
  const reader = req.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

const fail = (status: number, error: string, code?: string) => NextResponse.json({ error, ...(code ? { code } : {}) }, { status })

// Envio de mídia pelo atendente (multipart: file, caption?, clientId?). Limite de 16 MB aplicado antes de montar o arquivo na memória.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ids = await sessionIds()
  if (!ids) return unauthorized()
  const unverified = await denyIfEmailUnverified(ids.userId) // e-mail ainda não confirmado: não envia mensagens
  if (unverified) return unverified
  const { workspaceId, userId } = ids
  if (!isValidId(params.id)) return notFound()

  const contentType = req.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data/i.test(contentType)) return fail(415, 'Envie o arquivo como multipart/form-data')

  const raw = await readLimited(req, MAX_OUTBOUND_BYTES + BODY_SLACK)
  if (!raw) return fail(413, 'O arquivo passa do limite de 16 MB', 'ARQUIVO_GRANDE')
  let form: FormData
  try {
    form = await new Response(new Uint8Array(raw), { headers: { 'content-type': contentType } }).formData()
  } catch {
    return fail(400, 'Formulário inválido')
  }
  const file = form.get('file')
  if (!(file instanceof File)) return fail(400, 'Arquivo ausente')
  const caption = form.get('caption')
  const clientIdRaw = form.get('clientId')
  const clientId = typeof clientIdRaw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(clientIdRaw) ? clientIdRaw : undefined
  if (file.size > MAX_OUTBOUND_BYTES) return fail(413, 'O arquivo passa do limite de 16 MB', 'ARQUIVO_GRANDE')

  try {
    const message = await sendUserMedia({
      workspaceId,
      conversationId: params.id,
      file: { data: Buffer.from(await file.arrayBuffer()), name: file.name, mime: file.type },
      caption: typeof caption === 'string' ? caption : undefined,
      clientId,
      userId,
    })
    return NextResponse.json(message, { status: 201 })
  } catch (e) {
    if (e instanceof SendError) return fail(e.status, e.message, e.code)
    throw e
  }
}
