// TOTP (RFC 6238) com node:crypto: HMAC-SHA1, 6 dígitos, passo de 30 s. Funções puras (sem banco).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const PERIOD = 30
export const DIGITS = 6

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('base32 inválido')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Segredo novo: 20 bytes (160 bits), em base32. */
export const generateSecret = () => base32Encode(randomBytes(20))

/** HOTP (RFC 4226) com o contador `counter` e `digits` dígitos. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', secret).update(msg).digest()
  const off = h[h.length - 1] & 0xf
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export const stepAt = (nowMs: number, period = PERIOD) => Math.floor(nowMs / 1000 / period)

/** Código TOTP do instante `nowMs` (usado em testes e para conferir). */
export function totpAt(secretB32: string, nowMs: number, digits = DIGITS, period = PERIOD): string {
  return hotp(base32Decode(secretB32), stepAt(nowMs, period), digits)
}

/**
 * Confere `code` contra os passos [atual-1, atual+1]. Devolve o passo que bateu ou null.
 * Compara os três candidatos em tempo constante (sem sair no primeiro acerto).
 */
export function matchStep(secretB32: string, code: string, nowMs: number, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const key = base32Decode(secretB32)
  const cur = stepAt(nowMs)
  const given = Buffer.from(code)
  let found: number | null = null
  for (let d = -window; d <= window; d++) {
    const cand = Buffer.from(hotp(key, cur + d))
    if (timingSafeEqual(cand, given) && found === null) found = cur + d
  }
  return found
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'PearChat'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`
}
