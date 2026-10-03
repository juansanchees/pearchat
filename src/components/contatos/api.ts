import { redirectIfUnauthorized } from '@/lib/auth-redirect'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const hasJson = typeof init?.body === 'string'
  const res = await fetch(url, {
    ...init,
    headers: hasJson ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
    cache: 'no-store',
  })
  if (!res.ok) {
    redirectIfUnauthorized(res.status)
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`)
  }
  return (await res.json()) as T
}

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'
