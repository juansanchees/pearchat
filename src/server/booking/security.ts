import { createHmac, timingSafeEqual } from 'node:crypto'

// Peças de segurança da página pública: hashes de IP/telefone, token de formulário com tempo e token do .ics.
// Tudo é HMAC com AUTH_SECRET (o IP e o telefone nunca são gravados em claro nos limites de abuso).

export const MIN_FILL_MS = 3_000
export const MAX_FORM_AGE_MS = 30 * 60_000

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET não configurado')
  return s
}

function mac(label: string, data: string): string {
  return createHmac('sha256', secret()).update(`${label}\u0000${data}`).digest('base64url')
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const hashIp = (ip: string): string => mac('ip', ip).slice(0, 32)
export const hashPhone = (workspaceId: string, e164: string): string => mac('tel', `${workspaceId}:${e164}`).slice(0, 32)

/** IP do cliente atrás do proxy confiável (Caddy/nginx): a ÚLTIMA entrada do x-forwarded-for é a que o proxy viu. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) return last.slice(0, 64)
  }
  return (headers.get('x-real-ip') ?? 'desconhecido').slice(0, 64)
}

/** Token do formulário: emitido no GET, vale de 3 s a 30 min depois, preso ao workspace. */
export function signFormToken(workspaceId: string, now = Date.now()): string {
  const ts = String(now)
  return `${ts}.${mac('form', `${workspaceId}:${ts}`)}`
}

export type FormTokenCheck = 'ok' | 'invalido' | 'rapido' | 'expirado'

export function verifyFormToken(workspaceId: string, token: string, now = Date.now()): FormTokenCheck {
  const dot = token.indexOf('.')
  if (dot < 1 || token.length > 200) return 'invalido'
  const ts = token.slice(0, dot)
  if (!/^\d{10,16}$/.test(ts)) return 'invalido'
  if (!safeEqual(token.slice(dot + 1), mac('form', `${workspaceId}:${ts}`))) return 'invalido'
  const age = now - Number(ts)
  if (age < MIN_FILL_MS) return 'rapido'
  if (age > MAX_FORM_AGE_MS) return 'expirado'
  return 'ok'
}

/** Token do .ics de um agendamento: só quem acabou de agendar recebe o link. */
export const signEventToken = (eventId: string): string => `${eventId}.${mac('ics', eventId)}`

export function verifyEventToken(token: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot < 1 || token.length > 200) return null
  const id = token.slice(0, dot)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  return safeEqual(token.slice(dot + 1), mac('ics', id)) ? id : null
}

// Limite em memória por chave (janela deslizante). Protege o banco de varredura/repetição; os limites de negócio
// (5 por hora por IP, 3 futuros por telefone) ficam no banco e valem para várias instâncias.
const buckets = new Map<string, number[]>()

/** true = permitido (e registra); false = estourou `max` em `windowMs`. */
export function rateAllow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const arr = (buckets.get(key) ?? []).filter((t) => t > now - windowMs)
  if (arr.length >= max) {
    buckets.set(key, arr)
    return false
  }
  arr.push(now)
  buckets.set(key, arr)
  if (buckets.size > 20_000) {
    for (const [k, v] of Array.from(buckets)) if (!v.some((t) => t > now - windowMs)) buckets.delete(k)
  }
  return true
}

export function resetRateLimits(): void {
  buckets.clear()
}
