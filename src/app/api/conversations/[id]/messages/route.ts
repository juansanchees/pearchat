import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, isValidId, notFound, readJson, sessionIds, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { senderFirstNames, toMessageDTO } from '@/server/messages/dto'
import { SendError, sendUserMessage } from '@/server/messages/send'

export const dynamic = 'force-dynamic'

const PAGE = 50

const postSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
})

type Ctx = { params: { id: string } }

// Últimas 50 mensagens em ordem cronológica. `cursor` = id da mensagem mais antiga já carregada.
export async function GET(req: NextRequest, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()

  const conv = await db.conversation.findFirst({ where: { id: params.id, workspaceId }, select: { id: true } })
  if (!conv) return notFound()

  const cursor = req.nextUrl.searchParams.get('cursor')
  if (cursor) {
    // O cursor precisa ser uma mensagem DESTA conversa; qualquer outro valor é 400, nunca 500.
    const ok = isValidId(cursor) && (await db.message.count({ where: { id: cursor, conversationId: conv.id } })) > 0
    if (!ok) return badRequest('Cursor inválido')
  }
  const rows = await db.message.findMany({
    where: { conversationId: conv.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const names = await senderFirstNames(rows)
  return NextResponse.json(rows.reverse().map((m) => toMessageDTO(m, names.get(m.senderUserId ?? ''))))
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const ids = await sessionIds()
  if (!ids) return unauthorized()
  const { workspaceId, userId } = ids
  if (!isValidId(params.id)) return notFound()

  const json = await readJson(req)
  const parsed = postSchema.safeParse(json)
  if (!parsed.success) return badRequest('Mensagem inválida (1 a 4096 caracteres)')

  try {
    const message = await sendUserMessage({ workspaceId, conversationId: params.id, body: parsed.data.body,
      clientId: parsed.data.clientId, userId,
    })
    return NextResponse.json(message, { status: 201 })
  } catch (e) {
    if (e instanceof SendError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    throw e
  }
}
