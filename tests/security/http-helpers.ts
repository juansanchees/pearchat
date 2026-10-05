// Ajudantes dos testes HTTP da onda 1 (servidor de teste já no ar; sem TEST_BASE_URL os testes são pulados).
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { randomIp, type TestUser } from './helpers'

export const BASE = process.env.TEST_BASE_URL
/** Servidor de teste SEM banco (porta 3049, banco inalcançável): simula a queda do banco sem tocar em nada. */
export const NODB = process.env.TEST_BASE_URL_NODB
export const APP_ORIGIN = 'http://onda1a.localhost:3048' // = AUTH_URL do lançador

export type Res = { status: number; headers: Headers; json: () => Promise<Record<string, unknown>>; text: () => Promise<string> }

/** Login por senha pela API do Auth.js. Tenta de novo se o servidor de teste (conexões do banco = 2) estiver ocupado. */
export async function login(u: TestUser): Promise<string> {
  let cookie = ''
  for (let attempt = 0; attempt < 3 && !/session-token/.test(cookie); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000))
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
    const jar = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]!)
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.join('; '), 'x-forwarded-for': randomIp() },
      body: new URLSearchParams({ csrfToken, email: u.email, password: u.password, json: 'true' }).toString(),
    })
    cookie = [...jar, ...res.headers.getSetCookie().map((c) => c.split(';')[0]!)].join('; ')
  }
  assert.match(cookie, /session-token/, 'login por senha deve emitir a sessão')
  return cookie
}

export const call = (cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }) as Promise<Res>

export function chunked(totalBytes: number, headers: Record<string, string> = {}): RequestInit {
  const piece = new Uint8Array(64 * 1024).fill(97)
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= totalBytes) return c.close()
      c.enqueue(piece)
      sent += piece.byteLength
    },
  })
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, duplex: 'half' } as RequestInit
}


/** Requisição "crua" (node:http), para escolher o cabeçalho Host como um proxy (Caddy) faria. */
export function rawRequest(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string | Buffer,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  const u = new URL(baseUrl)
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** Corpo de teste com N bytes (o conteúdo não importa: o que se mede é o limite de tamanho). */
export const filler = (n: number, ch = 'a') => Buffer.alloc(n, ch)
export { assert }
