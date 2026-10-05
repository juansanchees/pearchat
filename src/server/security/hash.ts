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

/**
 * Normaliza o IP para a chave de limite: IPv4 mapeado em IPv6 (::ffff:1.2.3.4) vira IPv4 e IPv6 vira o prefixo /64
 * (quem tem um bloco IPv6 rotaciona o final do endereço à vontade; o /64 é o "endereço" de um assinante).
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return mapped[1]
  if (!ip.includes(':')) return ip.slice(0, 64)
  // Expande "::" e mantém os 4 primeiros grupos (64 bits).
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  ip = groups.slice(0, 4).map((g) => (g || '0').replace(/^0+(?=.)/, '')).join(':')
  return `${ip}::/64`.slice(0, 64)
}

/**
 * IP do cliente: a ÚLTIMA entrada de x-forwarded-for (a que o proxy do servidor acrescentou), senão x-real-ip.
 * Só é confiável porque o app escuta apenas em 127.0.0.1 atrás do Caddy (que sempre acrescenta o IP real do cliente no
 * fim): as entradas à esquerda podem ser forjadas pelo cliente e são ignoradas. Sem proxy (desenvolvimento) cai em 'local'.
 */
export function clientIpFromHeaders(h: { get(name: string): string | null } | null | undefined): string {
  const xff = h?.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) return normalizeIp(parts[parts.length - 1])
  }
  return normalizeIp(h?.get('x-real-ip') || 'local')
}
