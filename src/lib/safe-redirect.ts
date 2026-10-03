// Destino pós-login (?callbackUrl=): só caminho interno seguro; qualquer outra coisa vira "/".
// Bloqueia open redirect (//host, /\host, URL absoluta), injeção de cabeçalho (CR/LF), URLs gigantes e telas de auth/API.
const MAX_LEN = 512
const BLOCKED = ['/login', '/registro', '/api/']

export function safeRedirectPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LEN) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  if (/[\r\n\\]/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return fallback
  const path = raw.split(/[?#]/)[0].toLowerCase()
  if (BLOCKED.some((b) => (b.endsWith('/') ? path.startsWith(b) : path === b || path.startsWith(`${b}/`)))) return fallback
  return raw
}
