import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import { clientIpFromHeaders } from '@/server/security/hash'

export const RESET_TTL_MS = 30 * 60 * 1000
const PREFIX = 'pwreset:'

export const RESET_PREFIX = PREFIX
export const resetIdentifier = (email: string) => `${PREFIX}${email}`
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

// Os limites de tentativas ficam no banco (src/server/security/rate-limit.ts), não mais em memória.
export function clientIp(req: NextRequest): string {
  return clientIpFromHeaders(req.headers)
}
