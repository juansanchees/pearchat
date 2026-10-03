import { onlyDigits } from '@/server/whatsapp/phone'

const MIN_DIGITS = 10
const MAX_DIGITS = 15

/**
 * Normaliza para E.164 ("+5511987654321"), assumindo DDI 55 quando ausente.
 * Retorna null se o número for inválido.
 */
export function normalizePhone(raw: string): string | null {
  const text = raw.trim().replace(/^'/, '')
  const international = text.startsWith('+') || text.startsWith('00')
  let digits = onlyDigits(text)
  if (text.startsWith('00')) digits = digits.slice(2)
  if (!international) {
    if (digits.startsWith('0') && digits.length >= 11) digits = digits.replace(/^0+/, '') // tronco "011..."
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null
  if (digits.startsWith('55') && digits.length !== 12 && digits.length !== 13) return null
  return `+${digits}`
}

/** "+5511987654321" -> "+55 11 98765-4321"; fora do Brasil, devolve o número como está. */
export function formatPhoneDisplay(e164: string | null): string {
  if (!e164) return ''
  const d = onlyDigits(e164)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const local = d.slice(4)
    const cut = local.length - 4
    return `+55 ${d.slice(2, 4)} ${local.slice(0, cut)}-${local.slice(cut)}`
  }
  return `+${d}`
}

/**
 * Variantes equivalentes de um número brasileiro: com e sem o 9º dígito (celulares antigos têm 8
 * dígitos depois do DDD). Fora do Brasil devolve só o próprio número.
 */
export function phoneVariants(e164: string): string[] {
  const d = onlyDigits(e164)
  const out = new Set<string>([`+${d}`])
  if (d.startsWith('55')) {
    const rest = d.slice(2)
    if (rest.length === 11 && rest[2] === '9') out.add(`+55${rest.slice(0, 2)}${rest.slice(3)}`)
    else if (rest.length === 10 && /[6-9]/.test(rest[2])) out.add(`+55${rest.slice(0, 2)}9${rest.slice(2)}`)
  }
  return Array.from(out)
}

/**
 * Todos os formatos sob os quais o mesmo contato pode estar gravado (com/sem +55, com/sem o 9º
 * dígito, com máscara). Usado para achar um contato existente antes de criar outro.
 */
export function phoneCandidates(raw: string): string[] {
  const set = new Set<string>()
  const add = (p: string | null) => p && phoneVariants(p).forEach((v) => set.add(v))
  const digits = onlyDigits(raw).replace(/^0+/, '')
  add(normalizePhone(raw))
  if (digits) add(`+${digits}`)
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) add(`+55${digits}`)
  return Array.from(set)
}
