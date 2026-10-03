// Validação externa (sem SSH): node deploy/validate.mjs [URL_BASE]   (ou BASE_URL=https://pearchat.online)
// Com https o Auth.js usa __Secure-authjs.session-token e __Host-authjs.csrf-token; o jar abaixo guarda qualquer nome.
import { io } from 'socket.io-client'

const BASE = (process.argv[2] || process.env.BASE_URL || process.env.PEARCHAT_URL || 'https://pearchat.online').replace(/\/+$/, '')
const SECURE = BASE.startsWith('https://')
const EMAIL = process.env.PEARCHAT_EMAIL ?? 'mariana@doceatelie.com.br'
const PASS = process.env.PEARCHAT_PASS ?? 'pearchat123'
console.log(`Validando ${BASE}`)
const results = []
const jar = new Map()
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
const keep = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(';')
    const i = kv.indexOf('=')
    const name = kv.slice(0, i).trim()
    const val = kv.slice(i + 1)
    if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c) || val === '') jar.delete(name)
    else jar.set(name, val)
  }
}
const req = async (method, path, { body, form } = {}) => {
  const headers = { cookie: cookieHeader() }
  let payload
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) })
  keep(res)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // não-JSON
  }
  return { status: res.status, json, text }
}
const step = async (name, fn) => {
  try {
    const r = await fn()
    results.push({ name, ok: r.ok, info: r.info })
  } catch (e) {
    results.push({ name, ok: false, info: `erro: ${e.cause?.code ?? e.message}` })
  }
}
const stripQr = (q) => (typeof q === 'string' ? q.replace(/^data:image\/\w+;base64,/, '') : '')

await step('GET /login', async () => {
  const r = await req('GET', '/login')
  return { ok: r.status === 200, info: `HTTP ${r.status}` }
})
await step('login (CSRF + credentials)', async () => {
  const c = await req('GET', '/api/auth/csrf')
  const csrfToken = c.json?.csrfToken
  if (!csrfToken) return { ok: false, info: `sem csrf (HTTP ${c.status})` }
  const r = await req('POST', '/api/auth/callback/credentials', {
    form: { csrfToken, email: EMAIL, password: PASS, callbackUrl: BASE + '/', json: 'true' },
  })
  const s = await req('GET', '/api/auth/session')
  const names = [...jar.keys()].filter((k) => /session-token/.test(k))
  const csrfNames = [...jar.keys()].filter((k) => /csrf-token/.test(k))
  const expected = SECURE ? '__Secure-authjs.session-token' : 'authjs.session-token'
  const nameOk = names.some((n) => n === expected || n.startsWith(expected + '.'))
  return { ok: !!s.json?.user && nameOk, info: `callback HTTP ${r.status}; sessão=${s.json?.user ? 'válida' : 'vazia'}; cookie=${names.join(',') || 'nenhum'} (esperado ${expected}); csrf=${csrfNames.join(',') || 'nenhum'}` }
})
await step('GET /api/me', async () => {
  const r = await req('GET', '/api/me')
  return { ok: r.status === 200, info: `HTTP ${r.status}` }
})
await step('GET /api/conversations', async () => {
  const r = await req('GET', '/api/conversations')
  const list = Array.isArray(r.json) ? r.json : (r.json?.conversations ?? r.json?.items)
  return { ok: r.status === 200, info: `HTTP ${r.status}; itens=${Array.isArray(list) ? list.length : '?'}` }
})
await step('Socket.io autenticado (/api/socket)', () =>
  new Promise((resolve) => {
    const s = io(BASE, { path: '/api/socket', extraHeaders: { cookie: cookieHeader() }, transports: ['polling', 'websocket'], reconnection: false, timeout: 15000 })
    const done = (ok, info) => {
      s.close()
      resolve({ ok, info })
    }
    s.on('connect', () => done(true, `conectado (${s.io.engine.transport.name})`))
    s.on('connect_error', (e) => done(false, `connect_error: ${e.message}`))
  }),
)
await step('POST /api/wa/disconnect', async () => {
  const r = await req('POST', '/api/wa/disconnect')
  return { ok: r.status === 200, info: `HTTP ${r.status}; status=${r.json?.status}` }
})
await step("POST /api/wa/connect {provider:'rapida'}", async () => {
  const r = await req('POST', '/api/wa/connect', { body: { provider: 'rapida' } })
  const raw = stripQr(r.json?.qr)
  const b64 = raw.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(raw)
  const err = r.status >= 400 ? `; erro=${r.json?.error ?? ''}` : ''
  return { ok: r.status === 200 && b64 && r.json?.status === 'aguardando_qr', info: `HTTP ${r.status}; status=${r.json?.status}; qr_base64=${b64 ? 'sim' : 'não'} (${raw.length} chars)${err}` }
})
await step('GET /api/wa/status', async () => {
  const r = await req('GET', '/api/wa/status')
  const raw = stripQr(r.json?.qr)
  return { ok: r.status === 200 && r.json?.status === 'aguardando_qr' && raw.length > 200, info: `HTTP ${r.status}; status=${r.json?.status}; qr=${raw.length} chars` }
})

for (const r of results) console.log(`${r.ok ? 'OK    ' : 'FALHOU'}  ${r.name}  ->  ${r.info}`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
