// Rótulos que o PearChat grava no lugar de conteúdos que não são uma mensagem de texto/mídia do cliente.
// Eventos de sistema e tipos sem equivalente: ficam visíveis na conversa, mas NÃO contam como "cliente falou"
// (a IA não responde a eles e a conversa não vira "esperando resposta"). Texto puro, sem I/O.

export const UNSUPPORTED_LABEL = '[Mensagem não suportada]'
export const CALL_LABEL = '[Chamada]'
export const POLL_LABEL = '[Enquete]'
export const GROUP_INVITE_LABEL = '[Convite de grupo]'
export const EVENT_LABEL = '[Evento]'

/** Corpos (e prefixos) que não valem como "o cliente escreveu": chamada, enquete, convite, evento, tipo desconhecido. */
export const NON_REPLYABLE_PREFIXES = [UNSUPPORTED_LABEL, CALL_LABEL, POLL_LABEL, GROUP_INVITE_LABEL, EVENT_LABEL] as const

export function isNonReplyableBody(body: string): boolean {
  const b = body.trim()
  return NON_REPLYABLE_PREFIXES.some((p) => b === p || b.startsWith(`${p} `))
}
