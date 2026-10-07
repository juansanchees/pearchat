import type { ContactRef } from './provider'

export const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** "5511987654321" ou "+55 11 98765-4321" -> "+5511987654321" */
export function toE164(raw: string): string {
  return `+${onlyDigits(raw)}`
}

/** Telefone só com dígitos, como as APIs esperam. */
export function recipientDigits(to: ContactRef): string {
  if (!to.telefone) throw new Error('Contato sem telefone')
  return onlyDigits(to.telefone)
}

/** Motivo gravado em Message.failReason quando o contato não tem para onde enviar. */
export const NO_RECIPIENT = 'Não foi possível enviar: o WhatsApp não informou o número deste contato'

/** LID do WhatsApp ("264913750589556" ou "264913750589556@lid") -> só os dígitos; null se não parece um LID (ex.: BSUID da Meta). */
export function lidDigits(waUserId: string | null | undefined): string | null {
  const id = (waUserId ?? '').trim().replace(/@lid$/, '')
  return /^\d{5,}$/.test(id) ? id : null
}

/**
 * Destino (`number`) de um envio pela Evolution API 2.3.x: o telefone só com dígitos, no formato internacional em que
 * foi gravado (nada de acrescentar DDI nem dígito). Na 2.3.7 a Evolution (createJid) só REMOVE: o 3º dígito de números 52/54 com 13 dígitos (o 1 mexicano / o 9 argentino) e o 9 de celulares brasileiros com DDD >= 31 e número começando em 7-9; nunca acrescenta. Depois confere o número no WhatsApp (onWhatsApp) e usa o JID devolvido.
 * Sem telefone, usa o JID completo do LID ("<lid>@lid"): é o único jeito de a Evolution aceitar um contato que só tem LID
 * (sem o sufixo, ela trata os dígitos como telefone e responde "exists: false").
 */
export function evolutionRecipient(to: ContactRef): string {
  const lid = lidDigits(to.waUserId)
  const phone = to.telefone ? onlyDigits(to.telefone) : ''
  // Defesa: um LID gravado por engano no campo de telefone continua sendo um LID.
  if (lid && (!phone || phone === lid)) return `${lid}@lid`
  if (phone) return phone
  throw new Error(NO_RECIPIENT)
}
