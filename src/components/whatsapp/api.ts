import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import type { WhatsAppStatusDTO } from '@/lib/types'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

async function request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<WhatsAppStatusDTO> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    redirectIfUnauthorized(res.status)
    const msg = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Erro inesperado'
    throw new ApiError(msg, res.status)
  }
  return data as WhatsAppStatusDTO
}

export const waApi = {
  connect: (provider: 'oficial' | 'rapida', numero?: string) => request('POST', '/api/wa/connect', { provider, numero }),
  status: () => request('GET', '/api/wa/status'),
  finish: (importarHistorico: boolean) => request('POST', '/api/wa/finish', { importarHistorico }),
  mockScan: () => request('POST', '/api/wa/mock/scan'),
  embeddedSignup: (payload: { code: string; phoneNumberId: string; wabaId: string }) =>
    request('POST', '/api/wa/embedded-signup/callback', payload),
}

/** Mensagem amigável a partir de qualquer erro. */
export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado')
