// Validação externa (sem SSH): node deploy/validate.mjs [URL_BASE]   (ou BASE_URL=https://seu-dominio)
//
// CONTA DE FUMAÇA: as credenciais NÃO ficam no código. Vêm de VALIDATE_EMAIL e VALIDATE_PASSWORD (ambiente) ou do arquivo local
// deploy/.validate.env (ignorado pelo git; formato CHAVE=valor). Sem elas, roda SÓ as verificações anônimas e avisa.
// Use uma conta DEDICADA a testes (nunca a de um cliente nem a sua pessoal com WhatsApp real).
//
// ATENÇÃO (WhatsApp): os dois últimos passos autenticados DESCONECTAM e reconectam o WhatsApp da conta de fumaça
// (POST /api/wa/disconnect e /api/wa/connect). Por isso só rodam com VALIDATE_WA_RESET=1 e SÓ se a conta NÃO tiver um
// WhatsApp conectado/conectando: se tiver, os dois passos são recusados (PULADO) para nunca derrubar um número de verdade.
//
// Com https o Auth.js usa __Secure-authjs.session-token e __Host-authjs.csrf-token; o jar abaixo guarda qualquer nome.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

const here = dirname(fileURLToPath(import.meta.url))

/** Lê deploy/.validate.env (CHAVE=valor, # comentários). Nunca imprime valores. */
function readLocalEnv() {
  const f = join(here, '.validate.env')
  const out = {}
  if (!existsSync(f)) return out
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const local = readLocalEnv()
const pick = (k) => process.env[k] || local[k] || ''

const BASE = (process.argv[2] || process.env.BASE_URL || process.env.PEARCHAT_URL || local.BASE_URL || 'https://pearchat.online').replace(/\/+$/, '')
const SECURE = BASE.startsWith('https://')
const EMAIL = pick('VALIDATE_EMAIL')
const PASS = pick('VALIDATE_PASSWORD')
const HAS_ACCOUNT = !!(EMAIL && PASS)
const WA_RESET = pick('VALIDATE_WA_RESET') === '1'
console.log(`Validando ${BASE}`)
if (!HAS_ACCOUNT) {
  console.log('AVISO: sem VALIDATE_EMAIL/VALIDATE_PASSWORD (ambiente ou deploy/.validate.env): rodando SÓ as verificações anônimas.')
}

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
const req = async (method, path, { body, form, anon } = {}) => {
  const headers = anon ? {} : { cookie: cookieHeader() }
  let payload
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(form).toString()
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) })
  if (!anon) keep(res)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // não-JSON
  }
  return { status: res.status, json, text, headers: res.headers }
}
const step = async (name, fn) => {
  try {
    const r = await fn()
    results.push({ name, ok: r.ok, info: r.info, skipped: !!r.skipped })
  } catch (e) {
    results.push({ name, ok: false, info: `erro: ${e.cause?.code ?? e.message}` })
  }
}
const stripQr = (q) => (typeof q === 'string' ? q.replace(/^data:image\/\w+;base64,/, '') : '')

// ---------- verificações ANÔNIMAS (sempre rodam) ----------
await step('GET /login', async () => {
  const r = await req('GET', '/login', { anon: true })
  return { ok: r.status === 200, info: `HTTP ${r.status}` }
})
await step('GET /api/health público: ok e SEM detalhes', async () => {
  const r = await req('GET', '/api/health', { anon: true })
  const leaks = r.json && ('versao' in r.json || 'uptimeSeg' in r.json || 'agendador' in r.json)
  return { ok: r.status === 200 && r.json?.ok === true && !leaks, info: `HTTP ${r.status}; ok=${r.json?.ok}; detalhes expostos=${leaks ? 'SIM (versão/uptime/agendador)' : 'não'}` }
})
await step('cabeçalhos de segurança (sem duplicar)', async () => {
  const r = await req('GET', '/login', { anon: true })
  const h = r.headers
  const nosniff = h.get('x-content-type-options')
  const xfo = h.get('x-frame-options')
  const csp = h.get('content-security-policy')
  const hsts = h.get('strict-transport-security')
  const problems = []
  if (nosniff !== 'nosniff') problems.push(`X-Content-Type-Options="${nosniff}"`)
  if (xfo !== 'DENY') problems.push(`X-Frame-Options="${xfo}"`)
  if (!csp || !/frame-ancestors/.test(csp)) problems.push('CSP sem frame-ancestors')
  if (h.get('x-powered-by')) problems.push('X-Powered-By presente')
  if (SECURE) {
    if (!hsts || !/includeSubDomains/i.test(hsts)) problems.push(`HSTS="${hsts}" (esperado com includeSubDomains)`)
    if (/preload/i.test(hsts ?? '')) problems.push('HSTS com preload (não era para estar)')
    if (!/same-origin-allow-popups/.test(h.get('cross-origin-opener-policy') ?? '')) problems.push('COOP ausente')
    if (/caddy/i.test(h.get('server') ?? '')) problems.push('Server: Caddy exposto')
  }
  return { ok: problems.length === 0, info: problems.length ? problems.join('; ') : 'ok' }
})
await step('GET /api/auth/csrf devolve token', async () => {
  const r = await req('GET', '/api/auth/csrf', { anon: true })
  return { ok: r.status === 200 && !!r.json?.csrfToken, info: `HTTP ${r.status}` }
})
await step('GET /api/me sem sessão = 401', async () => {
  const r = await req('GET', '/api/me', { anon: true })
  return { ok: r.status === 401, info: `HTTP ${r.status}` }
})
await step('rotas de teste/simulação não ficam públicas', async () => {
  const paths = ['/api/dev/engine/tick', '/api/dev/inbound', '/api/wa/mock/scan']
  const out = []
  let ok = true
  for (const p of paths) {
    const r = await req('GET', p, { anon: true })
    // Na borda (https): 404. Direto no app: 401 (sem sessão) ou 404/405. Nunca 200.
    const fine = SECURE ? r.status === 404 : [401, 403, 404, 405].includes(r.status)
    if (!fine) ok = false
    out.push(`${p}=${r.status}`)
  }
  return { ok, info: out.join(' ') }
})
await step('otimizador de imagens do Next desativado', async () => {
  const r = await req('GET', '/_next/image?url=%2Fbrand%2Fpearchat-symbol.svg&w=64&q=75', { anon: true })
  return { ok: r.status !== 200 && r.status < 500, info: `HTTP ${r.status} (esperado 404/400, nunca 200)` }
})
await step('Socket.io SEM sessão é recusado', () =>
  new Promise((resolve) => {
    const s = io(BASE, { path: '/api/socket', transports: ['polling'], reconnection: false, timeout: 15000 })
    const done = (ok, info) => {
      s.close()
      resolve({ ok, info })
    }
    s.on('connect', () => done(false, 'conectou sem sessão!'))
    s.on('connect_error', (e) => done(true, `recusado (${e.message})`))
  }),
)

// ---------- verificações AUTENTICADAS (conta de fumaça) ----------
let waConnected = null
if (HAS_ACCOUNT) {
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
  const loggedIn = results.find((r) => r.name.startsWith('login'))?.ok
  if (loggedIn) {
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
    await step('GET /api/wa/status (conta de fumaça)', async () => {
      const r = await req('GET', '/api/wa/status')
      waConnected = r.status === 200 && ['conectado', 'conectando'].includes(r.json?.status)
      return { ok: r.status === 200, info: `HTTP ${r.status}; status=${r.json?.status}` }
    })

    // Os dois passos que mexem no WhatsApp: opt-in explícito E conta sem número real conectado.
    const resetBlocked = !WA_RESET ? 'defina VALIDATE_WA_RESET=1 para rodar (desconecta/reconecta o WhatsApp DA CONTA DE FUMAÇA)' : waConnected !== false ? 'a conta tem WhatsApp conectado/conectando (ou o status não pôde ser lido): recusado para não derrubar um número real' : ''
    if (resetBlocked) {
      results.push({ name: 'POST /api/wa/disconnect', ok: true, skipped: true, info: `PULADO: ${resetBlocked}` })
      results.push({ name: "POST /api/wa/connect {provider:'rapida'}", ok: true, skipped: true, info: `PULADO: ${resetBlocked}` })
    } else {
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
      await step('GET /api/wa/status (QR)', async () => {
        const r = await req('GET', '/api/wa/status')
        const raw = stripQr(r.json?.qr)
        return { ok: r.status === 200 && r.json?.status === 'aguardando_qr' && raw.length > 200, info: `HTTP ${r.status}; status=${r.json?.status}; qr=${raw.length} chars` }
      })
    }
  }
}

for (const r of results) console.log(`${r.skipped ? 'PULADO ' : r.ok ? 'OK     ' : 'FALHOU '} ${r.name}  ->  ${r.info}`)
const failed = results.filter((r) => !r.ok).length
console.log(failed === 0 ? `\nVALIDATE_OK${HAS_ACCOUNT ? '' : ' (somente anônimas)'}` : `\nVALIDATE_FALHOU (${failed})`)
process.exit(failed === 0 ? 0 : 1)
