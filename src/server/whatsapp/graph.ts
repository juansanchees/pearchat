import { createHmac } from 'node:crypto'
import { graphVersion } from './config'

// Cliente da Graph API da Meta. Regras:
// - base META_GRAPH_BASE_URL (padrão https://graph.facebook.com) + versão META_GRAPH_VERSION (padrão v25.0);
// - `appsecret_proof` em toda chamada com token (HMAC-SHA256 do token com o segredo do app);
// - timeout; novas tentativas com espera para 5xx/limite de taxa/rede. POST só repete quando a Meta garantidamente
//   NÃO processou (HTTP 429 ou códigos de limite) ou quando a conexão nem abriu: nunca duplica uma mensagem;
// - erro tipado (GraphError) com code, subcode e fbtrace_id. Nunca loga token nem corpo de mensagem.

const DEFAULT_BASE = 'https://graph.facebook.com'
const DEFAULT_TIMEOUT_MS = 20_000
/** Códigos de limite de taxa/estrangulamento da Meta: a requisição não foi processada, pode repetir. */
const RATE_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131056])

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: number | null,
    public readonly subcode: number | null,
    public readonly fbtraceId: string | null,
    public readonly type: string | null = null,
    /** Mensagem amigável ao usuário final, quando a Meta manda (error_user_msg). */
    public readonly userMessage: string | null = null,
    /** Detalhes do erro (error_data.details), úteis para o diagnóstico. */
    public readonly details: string | null = null,
  ) {
    super(message)
    this.name = 'GraphError'
  }

  /** Resumo seguro para log (sem token, sem corpo de mensagem). */
  toLog(): string {
    return `GraphError status=${this.status} code=${this.code ?? '-'} subcode=${this.subcode ?? '-'} fbtrace_id=${this.fbtraceId ?? '-'}`
  }

  get isAuth(): boolean {
    return this.status === 401 || this.code === 190 || this.code === 0 || this.code === 10 || this.code === 200 || this.code === 131005
  }
}

export const isGraphError = (e: unknown): e is GraphError => e instanceof GraphError

export function baseUrl(): string {
  return (process.env.META_GRAPH_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
}

export function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET
  if (!secret) return null
  return createHmac('sha256', secret).update(token).digest('hex')
}

export type GraphRequest = {
  method?: 'GET' | 'POST' | 'DELETE'
  /** Caminho sem versão, ex.: "/123/messages". */
  path: string
  token?: string | null
  query?: Record<string, string | number | boolean | undefined>
  /** Corpo JSON. */
  body?: unknown
  /** Corpo multipart (upload de mídia). */
  form?: FormData
  timeoutMs?: number
  /** Máximo de tentativas (padrão 3). */
  attempts?: number
  /** Sem versão no caminho (ex.: download de URL de mídia já completa). */
  noVersion?: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const backoff = (attempt: number) => Math.min(4000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200)

function parseError(status: number, parsed: unknown, retryAfter?: string | null): GraphError {
  const err = parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as { error?: unknown }).error : null
  const e = err && typeof err === 'object' ? (err as Record<string, unknown>) : {}
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
  const data = e.error_data && typeof e.error_data === 'object' ? (e.error_data as Record<string, unknown>) : {}
  const g = new GraphError(
    typeof e.message === 'string' ? e.message.slice(0, 300) : `Graph API respondeu ${status}`,
    status,
    num(e.code),
    num(e.error_subcode),
    typeof e.fbtrace_id === 'string' ? e.fbtrace_id : null,
    typeof e.type === 'string' ? e.type : null,
    typeof e.error_user_msg === 'string' ? e.error_user_msg.slice(0, 300) : null,
    typeof data.details === 'string' ? data.details.slice(0, 300) : null,
  )
  void retryAfter
  return g
}

/** Chamada JSON à Graph API. Devolve o corpo já decodificado (ou null se vazio). */
export async function graph<T = unknown>(req: GraphRequest): Promise<T> {
  const method = req.method ?? 'GET'
  const attempts = Math.max(1, req.attempts ?? 3)
  const url = new URL(`${baseUrl()}${req.noVersion ? '' : `/${graphVersion()}`}${req.path}`)
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
  const headers: Record<string, string> = {}
  if (req.token) {
    headers.Authorization = `Bearer ${req.token}`
    const proof = appSecretProof(req.token)
    if (proof) url.searchParams.set('appsecret_proof', proof)
  }
  let body: BodyInit | undefined
  if (req.form) body = req.form
  else if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(req.body)
  }

  let last: GraphError | null = null
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(backoff(i - 1))
    let res: Response
    try {
      res = await fetch(url, { method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      last = new GraphError(timedOut ? 'Graph API demorou demais' : 'Graph API inacessível', 0, null, null, null)
      // Timeout em POST pode ter sido processado: não repete. Falha de conexão (sem resposta) repete.
      if (method === 'POST' && timedOut) throw last
      continue
    }
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (res.ok) return parsed as T
    const err = parseError(res.status, parsed, res.headers.get('retry-after'))
    last = err
    const rate = res.status === 429 || (err.code !== null && RATE_CODES.has(err.code))
    const transient = res.status >= 500 && res.status !== 501
    if (rate || (transient && method !== 'POST')) continue
    throw err
  }
  throw last ?? new GraphError('Graph API indisponível', 0, null, null, null)
}

/** Baixa o arquivo de uma URL de mídia (lookaside) COM o token, limitando o tamanho. Só chame com URLs vindas da Graph. */
export async function graphDownload(url: string, token: string, maxBytes: number): Promise<{ data: Buffer; mime?: string }> {
  const u = new URL(url)
  const base = new URL(baseUrl())
  // Segurança (SSRF): a URL de mídia sempre vem de uma resposta da Graph; ainda assim exige https de domínio da Meta
  // (ou o servidor falso de teste, que é o mesmo host da base configurada).
  const okHost = /(^|\.)(facebook\.com|fbsbx\.com|fbcdn\.net|whatsapp\.net|whatsapp\.com)$/i.test(u.hostname) || (u.host === base.host && u.protocol === base.protocol)
  if (!okHost || (u.protocol !== 'https:' && u.host !== base.host)) throw new GraphError('URL de mídia inesperada', 0, null, null, null)
  let res: Response
  try {
    res = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(60_000), redirect: 'error' })
  } catch {
    throw new GraphError('Download da mídia falhou', 0, null, null, null)
  }
  if (!res.ok) throw new GraphError(`Download da mídia respondeu ${res.status}`, res.status, null, null, null)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new GraphError('Arquivo grande demais', 413, null, null, null)
  const chunks: Buffer[] = []
  let total = 0
  const reader = res.body?.getReader()
  if (!reader) throw new GraphError('Resposta sem corpo', 0, null, null, null)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new GraphError('Arquivo grande demais', 413, null, null, null)
    }
    chunks.push(Buffer.from(value))
  }
  return { data: Buffer.concat(chunks), mime: res.headers.get('content-type')?.split(';')[0]?.trim() || undefined }
}
