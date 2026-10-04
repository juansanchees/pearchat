import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { badRequest, isValidId, notFound, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { SendError } from '@/server/messages/send'
import { sendUserTemplate } from '@/server/messages/send-template'

export const dynamic = 'force-dynamic'

const postSchema = z.object({
  templateId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  vars: z.array(z.string().max(200)).max(10).default([]),
})

type Ctx = { params: { id: string } }

// Envia um modelo aprovado da Meta à conversa (a saída quando a janela de 24 h está fechada).
export async function POST(req: NextRequest, { params }: Ctx) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()
  const parsed = postSchema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Escolha um modelo e preencha as variáveis')
  try {
    const message = await sendUserTemplate({ workspaceId, conversationId: params.id, templateId: parsed.data.templateId, vars: parsed.data.vars })
    return NextResponse.json(message, { status: 201 })
  } catch (e) {
    if (e instanceof SendError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    throw e
  }
}
