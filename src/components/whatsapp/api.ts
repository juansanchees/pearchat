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

async function request<T = WhatsAppStatusDTO>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
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
  return data as T
}

export const waApi = {
  connect: (provider: 'oficial' | 'rapida', numero?: string) => request('POST', '/api/wa/connect', { provider, numero }),
  status: () => request('GET', '/api/wa/status'),
  finish: (importarHistorico: boolean) => request('POST', '/api/wa/finish', { importarHistorico }),
  mockScan: () => request('POST', '/api/wa/mock/scan'),
  /** Cria o state de uso único do Cadastro incorporado e devolve o link hospedado pela Meta. */
  signupStart: () => request<{ state: string; expiresAt: string; mode: 'sdk' | 'hosted'; hostedUrl: string }>('POST', '/api/wa/embedded-signup/start'),
  embeddedSignup: (payload: { state: string; code: string; wabaId?: string; phoneNumberId?: string; businessId?: string; event?: string }) =>
    request('POST', '/api/wa/embedded-signup/callback', payload),
  /** Fluxo hospedado: procura o cadastro concluído na Meta. */
  hostedCheck: (payload: { state: string; numero: string }) =>
    request<{ status: 'waiting' } | { status: 'ambiguous'; message: string } | { status: 'connected'; dto: WhatsAppStatusDTO }>('POST', '/api/wa/embedded-signup/hosted/check', payload),
}

/** Mensagem amigável a partir de qualquer erro. */
export const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Erro inesperado')
