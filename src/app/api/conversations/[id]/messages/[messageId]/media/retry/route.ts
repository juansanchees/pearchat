import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isValidId, notFound, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { toMessageDTO } from '@/server/messages/dto'
import { transcriptionAvailable } from '@/server/media/ai-caps'
import { MAX_INBOUND_BYTES } from '@/server/media/mime'
import { emitMessageUpdated } from '@/server/media/events'
import { startInboundMedia } from '@/server/media/receive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Tentar de novo" de uma mídia recebida que não carregou: volta para pendente e baixa de novo em segundo plano.
export async function POST(_req: Request, { params }: { params: { id: string; messageId: string } }) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id) || !isValidId(params.messageId)) return notFound()

  const m = await db.message.findFirst({ where: { id: params.messageId, conversationId: params.id, conversation: { workspaceId } } })
  if (!m || !m.mediaType) return notFound()
  if (m.mediaStatus !== 'erro' || m.imported) return NextResponse.json({ error: 'Esta mídia não pode ser baixada de novo', code: 'NAO_REPETIVEL' }, { status: 409 })
  if ((m.mediaSize ?? 0) > MAX_INBOUND_BYTES) return NextResponse.json({ error: 'Arquivo grande demais', code: 'ARQUIVO_GRANDE' }, { status: 413 })

  const audio = m.mediaType === 'audio' && m.direction === 'IN'
  const updated = await db.message.update({
    where: { id: m.id },
    data: { mediaStatus: 'pendente', ...(audio ? { transcriptStatus: transcriptionAvailable() ? 'pendente' : 'indisponivel' } : {}) },
  })
  void emitMessageUpdated(m.id)
  startInboundMedia(m.id)
  return NextResponse.json(toMessageDTO(updated))
}
