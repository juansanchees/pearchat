import { db } from '@/lib/db'
import type { MessageDTO } from '@/lib/types'
import { OutboundError, contactRef, sendAndRecord } from '@/server/engine/outbound'
import { getConnected, shortError, templateFirstName } from '@/server/engine/util'
import { countTemplateVars, templateUnsupportedReason } from '@/server/whatsapp/template-rules'
import { senderFirstNames, toMessageDTO } from './dto'
import { SendError } from './send'
import { registerManualReply } from './takeover'

export type WindowInfo = {
  provider: 'oficial' | 'rapida' | null
  /** true = pode mandar texto livre. Na conexão rápida é sempre true. */
  open: boolean
  /** Fim da janela (24 h depois da última mensagem do cliente), quando aberta na API oficial. */
  expiresAt: string | null
  /** Modelos aprovados que podem ser enviados com a janela fechada (só API oficial, só com a janela fechada). */
  templates: Array<{ id: string; name: string; body: string; vars: number; category: 'MARKETING' | 'UTILIDADE' }>
  /** Primeiro nome do contato (para preencher {{1}}). */
  firstName: string
}

/** Estado da janela de 24 h de uma conversa (para o aviso acima do campo de mensagem). */
export async function getWindowInfo(workspaceId: string, conversationId: string): Promise<WindowInfo | null> {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
  if (!conversation) return null
  const session = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { provider: true, status: true } })
  const firstName = templateFirstName(conversation.contact.nome, conversation.contact)
  if (!session || session.status !== 'CONECTADO' || session.provider !== 'OFICIAL') {
    return { provider: session?.provider === 'RAPIDA' ? 'rapida' : null, open: true, expiresAt: null, templates: [], firstName }
  }
  const last = await db.message.findFirst({
    where: { conversationId, direction: 'IN', imported: false },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const expires = last ? last.createdAt.getTime() + 24 * 3_600_000 : 0
  const open = expires > Date.now()
  if (open) return { provider: 'oficial', open: true, expiresAt: new Date(expires).toISOString(), templates: [], firstName }
  const tpls = await db.template.findMany({ where: { workspaceId, status: 'APROVADO', metaId: { not: null } }, orderBy: { name: 'asc' } })
  return {
    provider: 'oficial',
    open: false,
    expiresAt: null,
    firstName,
    templates: tpls
      .filter((t) => !templateUnsupportedReason(t.components))
      .map((t) => ({ id: t.id, name: t.name, body: t.body, vars: countTemplateVars(t.body), category: t.category })),
  }
}

/** Envia um modelo APROVADO ao contato da conversa (resposta fora da janela). Conta como resposta manual. */
export async function sendUserTemplate(input: { workspaceId: string; conversationId: string; templateId: string; vars: string[]; userId?: string }): Promise<MessageDTO> {
  const { workspaceId, conversationId } = input
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, workspaceId }, include: { contact: true } })
  if (!conversation) throw new SendError('NAO_ENCONTRADA', 404, 'Conversa não encontrada')
  const session = await getConnected(workspaceId)
  if (!session) throw new SendError('NAO_CONECTADO', 409, 'WhatsApp não está conectado')
  if (!session.official) throw new SendError('NAO_SUPORTADO', 422, 'Modelos só existem na conexão oficial')
  const tpl = await db.template.findFirst({ where: { id: input.templateId, workspaceId } })
  if (!tpl || tpl.status !== 'APROVADO' || !tpl.metaId) throw new SendError('NAO_SUPORTADO', 422, 'Escolha um modelo aprovado pela Meta')
  const n = countTemplateVars(tpl.body)
  const vars = Array.from({ length: n }, (_, i) => (input.vars[i] ?? '').replace(/[\r\n\t]+/g, ' ').trim())
  if (vars.some((v) => !v)) throw new SendError('ARQUIVO_INVALIDO', 400, 'Preencha todas as variáveis do modelo')
  const body = tpl.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, i: string) => vars[Number(i) - 1] ?? '')

  try {
    const sent = await sendAndRecord({
      session,
      conversationId,
      to: contactRef(conversation.contact),
      author: 'USER',
      content: { kind: 'template', name: tpl.name, vars, body },
      senderUserId: input.userId,
    })
    await registerManualReply({ conversationId, currentMode: conversation.mode, at: sent.createdAt, userId: input.userId })
    return toMessageDTO(sent, (await senderFirstNames([sent])).get(input.userId ?? ''))
  } catch (e) {
    if (e instanceof OutboundError) throw new SendError('ENVIO_FALHOU', 502, e.message)
    throw new SendError('ENVIO_FALHOU', 502, shortError(e))
  }
}
