import { createHmac, timingSafeEqual } from 'node:crypto'

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET não configurado')
  return s
}

/** HMAC-SHA256 (hex) com o AUTH_SECRET e um domínio, para que o mesmo valor gere hashes distintos por finalidade. */
export function hmac(domain: string, value: string): string {
  return createHmac('sha256', secret()).update(`${domain}\u0000${value}`).digest('hex')
}

/** Comparação em tempo constante de duas strings (tamanhos diferentes = falso, sem vazar onde difere). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** IP do cliente: a ÚLTIMA entrada de x-forwarded-for (a que o proxy do servidor acrescentou), senão x-real-ip. */
export function clientIpFromHeaders(h: { get(name: string): string | null } | null | undefined): string {
  const xff = h?.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1].slice(0, 64)
  }
  return (h?.get('x-real-ip') || 'local').slice(0, 64)
}
