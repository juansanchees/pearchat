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
