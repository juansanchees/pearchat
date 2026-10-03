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
