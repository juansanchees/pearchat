import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'

export const RESET_TTL_MS = 30 * 60 * 1000
const PREFIX = 'pwreset:'

export const RESET_PREFIX = PREFIX
export const resetIdentifier = (email: string) => `${PREFIX}${email}`
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

// Limitador simples em memória (por processo): suficiente como freio básico.
const hits = new Map<string, number[]>()
export function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [k, v] of Array.from(hits)) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
  }
  return false
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}
