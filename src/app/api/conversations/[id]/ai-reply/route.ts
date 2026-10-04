import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { conversationPendingState, requestAiReply } from '@/server/engine/pending'
import { pendingFail } from '@/server/engine/pending-http'
import { isValidId, notFound, sessionWorkspaceId, unauthorized } from '@/server/messages/api'

export const dynamic = 'force-dynamic'

// A conversa está esperando resposta? (a tela mostra "Responder com a IA"). Uso comum: os três papéis.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('conversations.use')
  if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()
  return NextResponse.json(await conversationPendingState(workspaceId, params.id))
}

// "Responder com a IA": enfileira a resposta à última mensagem do cliente. Não aceita texto nem destinatário:
// só o id da conversa (do espaço da sessão). Clicar duas vezes não gera duas respostas.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('conversations.use')
  if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!isValidId(params.id)) return notFound()

  const r = await requestAiReply(workspaceId, params.id)
  if (!r.ok) return r.code === 'NAO_ENCONTRADA' ? notFound() : pendingFail(r.code)
  return NextResponse.json({ ok: true, enfileirada: !r.jaEnfileirada, jaEnfileirada: r.jaEnfileirada }, { status: 202 })
}
