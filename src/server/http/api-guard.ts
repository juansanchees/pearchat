// Defesa em profundidade das rotas /api autenticadas, aplicada no middleware (Edge: sem imports de Node).
//  1. CSRF: requisição que muda estado só vale vinda da própria origem (o cookie SameSite=Lax já protege hoje; isto
//     cobre subdomínios futuros e navegadores antigos). Sem Origin (cliente que não é navegador) segue; com Origin
//     de outro site, ou Sec-Fetch-Site: cross-site, é recusada.
//  2. Corpo grande já declarado: 413 antes de a rota ler qualquer coisa (o corpo "chunked" é cortado na leitura, em body.ts).

import { JSON_LIMIT_BYTES } from './body'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const MB = 1024 * 1024
/** Limite de corpo por rota (bytes). Padrão = o de readJson/parseBody (256 KB): é o maior JSON legítimo do app. */
export function bodyLimitFor(pathname: string): number {
  if (/^\/api\/conversations\/[^/]+\/media$/.test(pathname)) return 17 * MB // arquivo de até 16 MB + multipart
  if (pathname === '/api/contacts/import') return 9 * MB // CSV de até 8 MB
  if (pathname === '/api/me/avatar' || /^\/api\/spaces\/[^/]+\/logo$/.test(pathname)) return 3 * MB // imagem de até 2 MB
  return JSON_LIMIT_BYTES
}

type Req = { method: string; headers: { get(name: string): string | null }; nextUrl: { pathname: string } }

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase()
  } catch {
    return null
  }
}

/** A origem é o próprio app? (Host da requisição, X-Forwarded-Host do proxy ou o endereço público configurado.) */
export function sameOrigin(origin: string, req: Pick<Req, 'headers'>, appUrls: Array<string | undefined> = [process.env.AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]): boolean {
  const o = hostOf(origin)
  if (!o) return false
  const allowed = new Set<string>()
  const host = req.headers.get('host')
  if (host) allowed.add(host.toLowerCase())
  const fwd = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (fwd) allowed.add(fwd.toLowerCase())
  for (const u of appUrls) {
    const h = hostOf(u)
    if (h) allowed.add(h)
  }
  return allowed.has(o)
}

export type GuardVerdict = { status: 403 | 413; error: string } | null

export function apiGuardVerdict(req: Req): GuardVerdict {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null
  const origin = req.headers.get('origin')
  if (origin && origin !== 'null' && !sameOrigin(origin, req)) return { status: 403, error: 'Origem não permitida.' }
  if (origin === 'null') return { status: 403, error: 'Origem não permitida.' }
  if (!origin && req.headers.get('sec-fetch-site') === 'cross-site') return { status: 403, error: 'Origem não permitida.' }
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > bodyLimitFor(req.nextUrl.pathname)) return { status: 413, error: 'O pedido é grande demais.' }
  return null
}
