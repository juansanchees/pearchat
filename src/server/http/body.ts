// Leitura de corpo de requisição COM LIMITE de tamanho, em streaming: um corpo `chunked` (sem content-length) de
// centenas de MB nunca é carregado inteiro na memória. Helper único das rotas anônimas e autenticadas.

/** Limite padrão para JSON/formulário pequeno. Uploads (mídia, CSV, foto) têm limite próprio. */
export const JSON_LIMIT_BYTES = 256 * 1024
/** Rotas anônimas: corpos minúsculos (e-mail, senha, código). */
export const SMALL_LIMIT_BYTES = 16 * 1024

export class BodyTooLargeError extends Error {
  constructor() {
    super('body_too_large')
    this.name = 'BodyTooLargeError'
  }
}

/** Lê o corpo até `max` bytes. Lança BodyTooLargeError se passar (declarado no content-length ou, em streaming, ao ler). */
export async function readBytesLimited(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLargeError()
  const body = req.body
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

export async function readTextLimited(req: Request, max: number = JSON_LIMIT_BYTES): Promise<string> {
  return new TextDecoder().decode(await readBytesLimited(req, max))
}

export type JsonBody = { ok: true; body: unknown } | { ok: false; status: 400 | 413 }

/** JSON com limite: 413 se grande demais, 400 se quebrado. Nunca lança por causa do conteúdo. */
export async function readJsonLimited(req: Request, max: number = JSON_LIMIT_BYTES): Promise<JsonBody> {
  let text: string
  try {
    text = await readTextLimited(req, max)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return { ok: false, status: 413 }
    return { ok: false, status: 400 }
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400 }
  }
}

export const TOO_LARGE_MESSAGE = 'O pedido é grande demais.'

// Texto que o Postgres/Prisma não aceitam: NUL (\u0000) e surrogates soltos. Viram 400 em vez de 500.
const BAD_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** true se qualquer string do valor (em qualquer profundidade) tem caractere proibido. */
export function hasBadText(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return BAD_TEXT.test(value)
  if (depth > 8 || value === null || typeof value !== 'object') return false
  const items = Array.isArray(value) ? value : Object.entries(value).flat()
  return items.some((v) => hasBadText(v, depth + 1))
}

/**
 * Substituto direto do `readJson` das rotas autenticadas: corpo JSON COM limite de tamanho; devolve null se quebrado,
 * grande demais ou com texto proibido (a rota responde 400; corpos grandes já declarados caem em 413 no middleware).
 */
export async function readJson(req: Request, max: number = JSON_LIMIT_BYTES): Promise<unknown> {
  const r = await readJsonLimited(req, max)
  return r.ok && !hasBadText(r.body) ? r.body : null
}
