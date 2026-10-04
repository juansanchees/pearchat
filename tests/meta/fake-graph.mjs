// Graph API FALSA para testes (porta 3036). Respostas no formato real confirmado na documentação da Meta.
// Controle: GET /__log (requisições gravadas), POST /__reset, POST /__cfg (JSON mesclado em cfg).
import http from 'node:http'
import { createHmac } from 'node:crypto'

const SECRET = 'segredo-de-teste-meta'
const V = '/v25.0'
const log = []
const cfg = {
  // code -> { token, waba, phone, phoneInfo }
  codes: {},
  // token -> { wabas: [waba] , valid: true }
  tokens: {},
  wabas: {},
  media: {},
  templates: {}, // waba -> [template]
  templateSeq: 1,
  sentSeq: 1,
  failNext: null,
}
const state = () => ({ log, cfg })

function err(res, status, code, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message, type: 'OAuthException', code, fbtrace_id: `TRACE_${code}`, ...extra } }))
}
const ok = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const raw = await readBody(req)
  const ctype = req.headers['content-type'] || ''
  let body = null
  if (ctype.includes('application/json') && raw.length) body = JSON.parse(raw.toString('utf8'))
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '')
  const proof = url.searchParams.get('appsecret_proof')
  const proofOk = auth ? proof === createHmac('sha256', SECRET).update(auth).digest('hex') : null
  const entry = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, token: auth || null, proofOk, multipart: ctype.includes('multipart') ? { size: raw.length } : null }
  if (!url.pathname.startsWith('/__')) log.push(entry)

  // ----- controle
  if (url.pathname === '/__log') return ok(res, log)
  if (url.pathname === '/__reset') {
    log.length = 0
    return ok(res, { ok: true })
  }
  if (url.pathname === '/__cfg') {
    for (const [k, v] of Object.entries(body || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && cfg[k] && typeof cfg[k] === 'object') Object.assign(cfg[k], v)
      else cfg[k] = v
    }
    return ok(res, { ok: true })
  }

  // download de mídia (sem versão)
  const dl = url.pathname.match(/^\/dl\/(.+)$/)
  if (dl) {
    if (!cfg.tokens[auth]?.valid) return err(res, 401, 190, 'Invalid OAuth access token.')
    const m = cfg.media[dl[1]]
    if (!m) return err(res, 404, 100, 'media not found')
    res.writeHead(200, { 'content-type': m.mime, 'content-length': Buffer.from(m.dataB64, 'base64').length })
    return res.end(Buffer.from(m.dataB64, 'base64'))
  }

  if (!url.pathname.startsWith(V + '/')) return err(res, 404, 100, `rota sem versão: ${url.pathname}`)
  const path = url.pathname.slice(V.length)

  // troca do code
  if (path === '/oauth/access_token') {
    const c = cfg.codes[url.searchParams.get('code')]
    if (!c || url.searchParams.get('client_secret') !== SECRET) return err(res, 400, 100, 'Error validating verification code.', { error_subcode: 36007 })
    return ok(res, { access_token: c.token, token_type: 'bearer' })
  }

  // token do negócio (fluxo hospedado): autenticado com o token do sistema
  let m = path.match(/^\/(\d+)\/system_user_access_tokens$/)
  if (m && req.method === 'POST') {
    if (auth !== 'system-token-de-teste' || url.searchParams.get('fetch_only') !== 'true') return err(res, 400, 100, 'bad system token request')
    const biz = cfg.businesses?.[m[1]]
    if (!biz) return err(res, 400, 100, 'unknown business')
    return ok(res, { access_token: biz.token })
  }

  // a partir daqui: exige token válido + appsecret_proof correto
  const tk = cfg.tokens[auth]
  if (!auth || !tk) return err(res, 401, 190, 'Invalid OAuth access token - Cannot parse access token')
  if (!tk.valid) return err(res, 401, 190, 'Error validating access token: Session has expired')
  if (!proofOk) return err(res, 400, 100, 'Invalid appsecret_proof provided in the API argument')

  // WABA
  m = path.match(/^\/(\d+)\/phone_numbers$/)
  if (m && req.method === 'GET') {
    if (!tk.wabas.includes(m[1])) return err(res, 403, 100, 'Unsupported get request. Object does not exist or missing permissions', { error_subcode: 33 })
    return ok(res, { data: (cfg.wabas[m[1]]?.phones || []).map((p) => ({ id: p.id, display_phone_number: p.display, verified_name: p.name, quality_rating: 'GREEN', status: p.status || 'CONNECTED' })) })
  }
  m = path.match(/^\/(\d+)\/subscribed_apps$/)
  if (m && req.method === 'POST') {
    if (!tk.wabas.includes(m[1])) return err(res, 403, 100, 'no access')
    return ok(res, { success: true })
  }
  m = path.match(/^\/(\d+)\/message_templates$/)
  if (m) {
    const waba = m[1]
    if (!tk.wabas.includes(waba)) return err(res, 403, 100, 'no access')
    cfg.templates[waba] ||= []
    if (req.method === 'GET') return ok(res, { data: cfg.templates[waba], paging: { cursors: { before: 'a', after: 'b' } } })
    if (req.method === 'POST') {
      if (!/^[a-z0-9_]+$/.test(body.name)) return err(res, 400, 100, 'Invalid parameter', { error_user_msg: 'O nome do modelo só pode ter minúsculas, números e _', error_subcode: 2388023 })
      if (cfg.templates[waba].some((t) => t.name === body.name && t.language === body.language)) return err(res, 400, 100, 'Invalid parameter', { error_user_msg: 'Já existe um modelo com esse nome e idioma', error_subcode: 2388024 })
      const id = String(9000 + cfg.templateSeq++)
      const t = { id, name: body.name, language: body.language, category: body.category, status: 'PENDING', components: body.components }
      cfg.templates[waba].push(t)
      return ok(res, { id, status: 'PENDING', category: body.category })
    }
    if (req.method === 'DELETE') {
      const before = cfg.templates[waba].length
      cfg.templates[waba] = cfg.templates[waba].filter((t) => t.id !== url.searchParams.get('hsm_id'))
      if (cfg.templates[waba].length === before) return err(res, 404, 100, 'template not found')
      return ok(res, { success: true })
    }
  }

  // Número
  m = path.match(/^\/(\d+)\/register$/)
  if (m && req.method === 'POST') return cfg.failRegister ? err(res, 400, 133005, 'Two step verification PIN Mismatch') : ok(res, { success: true })
  m = path.match(/^\/(\d+)\/smb_app_data$/)
  if (m && req.method === 'POST') return ok(res, { messaging_product: 'whatsapp', request_id: 'req_' + body.sync_type })
  m = path.match(/^\/(\d+)\/media$/)
  if (m && req.method === 'POST') {
    const id = `MEDIA_UP_${log.length}`
    return ok(res, { id })
  }
  m = path.match(/^\/(\d+)\/messages$/)
  if (m && req.method === 'POST') {
    if (cfg.failNext) {
      const f = cfg.failNext
      cfg.failNext = null
      return err(res, f.status || 400, f.code, f.message || 'falha simulada', f.extra || {})
    }
    const to = body.to || body.recipient || ''
    if (to === '5511000131047') return err(res, 400, 131047, 'Re-engagement message', { error_data: { messaging_product: 'whatsapp', details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' } })
    return ok(res, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: `wamid.SENT${cfg.sentSeq++}` }] })
  }
  // leitura de número e de mídia (id numérico ou texto)
  m = path.match(/^\/([A-Za-z0-9_]+)$/)
  if (m && req.method === 'GET') {
    const media = cfg.media[m[1]]
    if (media) return ok(res, { url: `http://127.0.0.1:3036/dl/${m[1]}`, mime_type: media.mime, sha256: 'x', file_size: Buffer.from(media.dataB64, 'base64').length, id: m[1], messaging_product: 'whatsapp' })
    for (const w of Object.values(cfg.wabas)) {
      const p = w.phones.find((x) => x.id === m[1])
      if (p) return ok(res, { id: p.id, display_phone_number: p.display, verified_name: p.name, quality_rating: 'GREEN', status: p.status || 'CONNECTED', platform_type: p.platform || 'CLOUD_API' })
    }
    return err(res, 400, 100, 'Unsupported get request.')
  }
  return err(res, 404, 100, `não implementado: ${req.method} ${path}`)
})

server.listen(3036, '127.0.0.1', () => console.log('fake graph em 3036'))
export { state }
