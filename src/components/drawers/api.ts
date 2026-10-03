import { redirectIfUnauthorized } from '@/lib/auth-redirect'

// Chamadas JSON às rotas /api dos drawers. Erros viram Error com a mensagem do servidor.
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    redirectIfUnauthorized(res.status)
    const msg = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Tente novamente em instantes.'
    throw new Error(msg)
  }
  return data as T
}
