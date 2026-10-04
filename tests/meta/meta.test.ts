/* eslint-disable @typescript-eslint/no-explicit-any */
// Bateria da conexão oficial (Meta) contra o app em 127.0.0.1:3035 e a Graph FALSA em 127.0.0.1:3036.
// Uso (app em 127.0.0.1:3035 com Graph falsa em 3036, schema pearchat_test_d, WA_MOCK=false, META_OFICIAL_BETA_EMAILS='beta@teste.local, Beta2@teste.local'):
//   node tests/meta/fake-graph.mjs &   e depois   tsx --test tests/meta/meta.test.ts
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createHmac, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../../src/lib/db'
import { CloudApiProvider } from '../../src/server/whatsapp/cloud-api'

const BASE = 'http://127.0.0.1:3035'
const GRAPH = 'http://127.0.0.1:3036'
const SECRET = 'segredo-de-teste-meta'
assert.equal(new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema'), 'pearchat_test_d')

const uniq = () => randomBytes(4).toString('hex')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(80, 1)])

const created: string[] = []
async function makeUser(email = `u-${uniq()}@teste.local`) {
  const u = await db.user.create({ data: { nome: 'Teste Meta', email, passwordHash: await bcrypt.hash('Senha-Forte-1', 4), workspace: { create: { nome: 'Teste Meta' } } } })
  created.push(u.id)
  return { id: u.id, email, password: 'Senha-Forte-1', workspaceId: u.workspaceId }
}
const cookieJar = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ')
async function login(u: { email: string; password: string }) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieJar(csrfRes), 'x-forwarded-for': `192.0.2.${Math.floor(Math.random() * 250)}` },
    body: new URLSearchParams({ csrfToken, email: u.email, password: u.password }).toString(),
  })
  const set = res.headers.getSetCookie().find((c) => /authjs\.session-token=[^;]+/.test(c))
  assert.ok(set, 'login falhou')
  return set.split(';')[0]!
}
const api = (cookie: string, path: string, init: { method?: string; body?: unknown; form?: FormData } = {}) =>
  fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
    headers: { cookie, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  })
const gcfg = (body: unknown) => fetch(`${GRAPH}/__cfg`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const glog = async () => (await (await fetch(`${GRAPH}/__log`)).json()) as Array<{ method: string; path: string; query: Record<string, string>; body: Record<string, any>; token: string | null; proofOk: boolean | null; multipart: unknown }>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > end) throw new Error('tempo esgotado esperando a condição')
    await sleep(200)
  }
}
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
async function hook(payload: unknown, sig?: string | null) {
  const raw = JSON.stringify(payload)
  return fetch(`${BASE}/api/wa/meta`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig === null ? {} : { 'x-hub-signature-256': sig ?? sign(raw) }) }, body: raw })
}
const msgPayload = (phoneId: string, waba: string, value: Record<string, unknown>, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: waba, changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '551100000000', phone_number_id: phoneId }, ...value } }] }],
})

// Identificadores da Graph falsa
const W1 = '1000000000001', P1 = '2000000000001', B1 = '3000000000001'
const W2 = '1000000000002', P2 = '2000000000002'
const W3 = '1000000000003', P3 = '2000000000003'
const W5 = '1000000000005', P5 = '2000000000005', B5 = '3000000000005'

let A: Awaited<ReturnType<typeof makeUser>>, A2: Awaited<ReturnType<typeof makeUser>>, OUT: Awaited<ReturnType<typeof makeUser>>
let ca: string, ca2: string, cout: string

before(async () => {
  for (const email of ['beta@teste.local', 'beta2@teste.local']) {
    const old = await db.user.findUnique({ where: { email }, select: { id: true, workspaceId: true } })
    if (old) {
      await db.user.delete({ where: { id: old.id } }).catch(() => undefined)
      await db.workspace.delete({ where: { id: old.workspaceId } }).catch(() => undefined)
    }
  }
  await db.metaPartnerEvent.deleteMany({})
  A = await makeUser('beta@teste.local')
  A2 = await makeUser('beta2@teste.local')
  OUT = await makeUser()
  ca = await login(A)
  ca2 = await login(A2)
  cout = await login(OUT)
  await fetch(`${GRAPH}/__reset`, { method: 'POST' })
  await gcfg({
    tokens: {
      tok1: { valid: true, wabas: [W1] },
      tok2: { valid: true, wabas: [W2] },
      tok3: { valid: true, wabas: [W3] },
      tokB: { valid: true, wabas: [W1] },
      tok5: { valid: true, wabas: [W5] },
      'system-token-de-teste': { valid: true, wabas: [] },
    },
    codes: { GOOD1: { token: 'tok1' }, GOOD2: { token: 'tok2' }, GOOD3: { token: 'tok3' }, GOODB: { token: 'tokB' } },
    wabas: {
      [W1]: { phones: [{ id: P1, display: '+55 11 98888-0001', name: 'Loja Um' }] },
      [W2]: { phones: [{ id: P2, display: '+55 11 98888-0002', name: 'Loja Dois' }] },
      [W3]: { phones: [{ id: P3, display: '+55 11 98888-0003', name: 'Loja Tres', platform: 'NOT_APPLICABLE' }] },
      [W5]: { phones: [{ id: P5, display: '+55 11 97777-0005', name: 'Loja Cinco' }] },
    },
    businesses: { [B5]: { token: 'tok5' } },
  })
})
after(async () => {
  for (const id of created) {
    const u = await db.user.findUnique({ where: { id }, select: { workspaceId: true } })
    await db.user.delete({ where: { id } }).catch(() => undefined)
    if (u) await db.workspace.delete({ where: { id: u.workspaceId } }).catch(() => undefined)
  }
  await db.$disconnect()
})

describe('0. ambiente', () => {
  it('schema de teste e servidor no ar', async () => {
    const r = await db.$queryRawUnsafe<Array<{ current_schema: string }>>('select current_schema()')
    assert.equal(r[0]!.current_schema, 'pearchat_test_d')
    assert.equal((await fetch(`${BASE}/api/health`)).status, 200)
  })
})

describe('1. beta fechado', () => {
  it('fora da lista: start e connect oficial recusados (409) e página diz oficialAtivo false', async () => {
    assert.equal((await api(cout, '/api/wa/embedded-signup/start', { method: 'POST' })).status, 409)
    assert.equal((await api(cout, '/api/wa/connect', { body: { provider: 'oficial' } })).status, 409)
    const html = await (await api(cout, '/whatsapp')).text()
    assert.match(html, /oficialAtivo\\?":false/)
    assert.match(html, /metaConfigured\\?":true/)
  })
  it('na lista: start devolve state e o link hospedado com extras da v4', async () => {
    const r = await api(ca, '/api/wa/embedded-signup/start', { method: 'POST' })
    assert.equal(r.status, 200)
    const j = (await r.json()) as { state: string; mode: string; hostedUrl: string }
    assert.match(j.state, /^[A-Za-z0-9_-]{20,}$/)
    assert.equal(j.mode, 'sdk')
    const u = new URL(j.hostedUrl)
    assert.equal(u.origin + u.pathname, 'https://business.facebook.com/messaging/whatsapp/onboard/')
    assert.equal(u.searchParams.get('app_id'), '1111111111')
    assert.equal(u.searchParams.get('config_id'), '2222222222')
    assert.deepEqual(JSON.parse(u.searchParams.get('extras')!), { sessionInfoVersion: '3', version: 'v4' })
    const html = await (await api(ca, '/whatsapp')).text()
    assert.match(html, /oficialAtivo\\?":true/)
  })
  it('sem sessão: 401', async () => {
    assert.equal((await fetch(`${BASE}/api/wa/embedded-signup/start`, { method: 'POST' })).status, 401)
  })
})

describe('2. cadastro incorporado (callback)', () => {
  const start = async (c: string) => ((await (await api(c, '/api/wa/embedded-signup/start', { method: 'POST' })).json()) as { state: string }).state
  it('code válido: conecta, assina o app, registra o número e grava o token criptografado', async () => {
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const state = await start(ca)
    const r = await api(ca, '/api/wa/embedded-signup/callback', { body: { state, code: 'GOOD1', wabaId: W1, phoneNumberId: P1, businessId: B1, event: 'FINISH' } })
    assert.equal(r.status, 200, await r.clone().text())
    const dto = (await r.json()) as { status: string; provider: string; numero: string; coexistence?: boolean }
    assert.equal(dto.status, 'conectado')
    assert.equal(dto.provider, 'oficial')
    assert.equal(dto.numero, '+55 11 98888-0001')
    assert.equal(dto.coexistence, undefined)
    const row = await db.whatsAppSession.findUniqueOrThrow({ where: { workspaceId: A.workspaceId } })
    assert.equal(row.status, 'CONECTADO')
    assert.equal(row.metaPhoneNumberId, P1)
    assert.equal(row.metaWabaId, W1)
    assert.equal(row.metaBusinessId, B1)
    assert.equal(row.metaVerifiedName, 'Loja Um')
    assert.ok(row.connectedAt)
    assert.ok(row.sessionData?.startsWith('v1:'))
    assert.ok(!row.sessionData?.includes('tok1'))
    const log = await glog()
    const paths = log.map((l) => `${l.method} ${l.path}`)
    assert.ok(paths.includes(`GET /v25.0/oauth/access_token`))
    assert.ok(paths.includes(`GET /v25.0/${W1}/phone_numbers`))
    assert.ok(paths.includes(`POST /v25.0/${W1}/subscribed_apps`))
    const reg = log.find((l) => l.path === `/v25.0/${P1}/register`)
    assert.ok(reg, 'registro do número')
    assert.match(reg.body.pin, /^\d{6}$/)
    assert.equal(reg.body.messaging_product, 'whatsapp')
    for (const l of log.filter((x) => x.token)) assert.equal(l.proofOk, true, `appsecret_proof em ${l.path}`)
  })
  it('state reutilizado: 403', async () => {
    const state = await start(ca2)
    const body = { state, code: 'GOOD2', wabaId: W2, phoneNumberId: P2, event: 'FINISH' }
    assert.equal((await api(ca2, '/api/wa/embedded-signup/callback', { body })).status, 200)
    assert.equal((await api(ca2, '/api/wa/embedded-signup/callback', { body })).status, 403)
  })
  it('state de outro usuário e state inventado: 403', async () => {
    const stateOut = await start(ca)
    assert.equal((await api(cout, '/api/wa/embedded-signup/callback', { body: { state: stateOut, code: 'GOOD1', wabaId: W1, phoneNumberId: P1 } })).status, 409) // fora do beta
    const stateA2 = await start(ca2)
    assert.equal((await api(ca, '/api/wa/embedded-signup/callback', { body: { state: stateA2, code: 'GOOD1', wabaId: W1, phoneNumberId: P1 } })).status, 403)
    assert.equal((await api(ca, '/api/wa/embedded-signup/callback', { body: { state: 'x'.repeat(30), code: 'GOOD1', wabaId: W1, phoneNumberId: P1 } })).status, 403)
  })
  it('code inválido: 400 e nada gravado', async () => {
    const state = await start(ca)
    const r = await api(ca, '/api/wa/embedded-signup/callback', { body: { state, code: 'BAD', wabaId: W1, phoneNumberId: P1 } })
    assert.equal(r.status, 400)
  })
  it('número de outra WABA: 403', async () => {
    const state = await start(ca)
    // token da WABA W1 + phone_number_id de W2
    const r = await api(ca, '/api/wa/embedded-signup/callback', { body: { state, code: 'GOOD1', wabaId: W1, phoneNumberId: P2 } })
    assert.equal(r.status, 403)
  })
  it('número já usado por outro workspace: 409', async () => {
    const state = await start(ca2)
    const r = await api(ca2, '/api/wa/embedded-signup/callback', { body: { state, code: 'GOODB', wabaId: W1, phoneNumberId: P1 } })
    assert.equal(r.status, 409)
    const row = await db.whatsAppSession.findUnique({ where: { workspaceId: A2.workspaceId } })
    assert.equal(row?.metaPhoneNumberId, P2) // continua com o dele
  })
  it('Coexistence: só waba_id, NÃO registra o número; finish pede contatos e histórico', async () => {
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    await db.whatsAppSession.update({ where: { workspaceId: A2.workspaceId }, data: { metaPhoneNumberId: null } })
    const state = await start(ca2)
    const r = await api(ca2, '/api/wa/embedded-signup/callback', { body: { state, code: 'GOOD3', wabaId: W3, event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' } })
    assert.equal(r.status, 200, await r.clone().text())
    const dto = (await r.json()) as { coexistence?: boolean; numero: string }
    assert.equal(dto.coexistence, true)
    assert.equal(dto.numero, '+55 11 98888-0003')
    let log = await glog()
    assert.ok(!log.some((l) => l.path.endsWith('/register')), 'não pode registrar número da Coexistence')
    assert.ok(log.some((l) => l.path === `/v25.0/${W3}/subscribed_apps`))
    const f = await api(ca2, '/api/wa/finish', { body: { importarHistorico: true } })
    assert.equal(f.status, 200)
    log = await glog()
    const sync = log.filter((l) => l.path === `/v25.0/${P3}/smb_app_data`).map((l) => l.body.sync_type)
    assert.deepEqual(sync, ['smb_app_state_sync', 'history'])
  })
})

describe('3. webhook', () => {
  it('verificação GET (challenge)', async () => {
    const ok = await fetch(`${BASE}/api/wa/meta?hub.mode=subscribe&hub.verify_token=verify-de-teste&hub.challenge=12345`)
    assert.equal(ok.status, 200)
    assert.equal(await ok.text(), '12345')
    assert.equal((await fetch(`${BASE}/api/wa/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`)).status, 403)
    assert.equal((await fetch(`${BASE}/api/wa/meta`)).status, 403)
  })
  it('assinatura ausente, inválida, curta, longa ou de outro segredo: 401 sem exceção', async () => {
    const p = msgPayload(P1, W1, {})
    assert.equal((await hook(p, null)).status, 401)
    assert.equal((await hook(p, 'sha256=zzzz')).status, 401)
    assert.equal((await hook(p, 'sha256=abcd')).status, 401)
    assert.equal((await hook(p, `sha256=${'a'.repeat(70)}`)).status, 401)
    assert.equal((await hook(p, 'md5=abc')).status, 401)
    assert.equal((await hook(p, sign(JSON.stringify(p), 'outro-segredo'))).status, 401)
    assert.equal((await hook(p)).status, 200)
  })
  it('JSON inválido com assinatura correta: 400', async () => {
    const raw = '{nao-json'
    const r = await fetch(`${BASE}/api/wa/meta`, { method: 'POST', headers: { 'x-hub-signature-256': sign(raw) }, body: raw })
    assert.equal(r.status, 400)
  })
  it('texto recebido vira mensagem; duplicata é ignorada; phone_number_id desconhecido: 200 sem efeito', async () => {
    const p = msgPayload(P1, W1, {
      contacts: [{ profile: { name: 'Cliente Texto' }, wa_id: '5511911110001' }],
      messages: [{ from: '5511911110001', id: 'wamid.IN_TEXT_1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Oi, tudo bem?' } }],
    })
    assert.equal((await hook(p)).status, 200)
    assert.equal((await hook(p)).status, 200)
    const msg = await until(() => db.message.findFirst({ where: { providerMessageId: 'wamid.IN_TEXT_1' }, include: { conversation: { include: { contact: true } } } }))
    assert.equal(msg.body, 'Oi, tudo bem?')
    assert.equal(msg.direction, 'IN')
    assert.equal(msg.conversation.workspaceId, A.workspaceId)
    assert.equal(msg.conversation.contact.telefone, '+5511911110001')
    assert.equal(msg.conversation.contact.nome, 'Cliente Texto')
    await sleep(600)
    assert.equal(await db.message.count({ where: { providerMessageId: 'wamid.IN_TEXT_1' } }), 1)
    const unk = msgPayload('999999999', W1, { contacts: [{ wa_id: '5511911110009' }], messages: [{ from: '5511911110009', id: 'wamid.UNK', timestamp: '1', type: 'text', text: { body: 'x' } }] })
    assert.equal((await hook(unk)).status, 200)
    await sleep(500)
    assert.equal(await db.message.count({ where: { providerMessageId: 'wamid.UNK' } }), 0)
  })
  it('rótulos: localização, contato, interativo, botão; reação não vira mensagem; tipo desconhecido', async () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const from = '5511911110002'
    const p = msgPayload(P1, W1, {
      contacts: [{ profile: { name: 'Cliente Rotulos' }, wa_id: from }],
      messages: [
        { from, id: 'wamid.LOC', timestamp: ts, type: 'location', location: { latitude: -23.5, longitude: -46.6, name: 'Padaria', address: 'Rua A, 10' } },
        { from, id: 'wamid.CT', timestamp: ts, type: 'contacts', contacts: [{ name: { formatted_name: 'Maria' }, phones: [{ phone: '+5511999990000' }] }] },
        { from, id: 'wamid.INT', timestamp: ts, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Confirmar' } } },
        { from, id: 'wamid.BTN', timestamp: ts, type: 'button', button: { text: 'Quero saber mais', payload: 'p' } },
        { from, id: 'wamid.REA', timestamp: ts, type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } },
        { from, id: 'wamid.WEIRD', timestamp: ts, type: 'unsupported' },
      ],
    })
    await hook(p)
    await until(async () => (await db.message.count({ where: { providerMessageId: { in: ['wamid.LOC', 'wamid.CT', 'wamid.INT', 'wamid.BTN', 'wamid.WEIRD'] } } })) === 5)
    const get = async (id: string) => (await db.message.findFirstOrThrow({ where: { providerMessageId: id } })).body
    assert.match(await get('wamid.LOC'), /^\[Localização\] Padaria, Rua A, 10 https:\/\/maps\.google\.com\/\?q=-23\.5,-46\.6$/)
    assert.equal(await get('wamid.CT'), '[Contato] Maria (+5511999990000)')
    assert.equal(await get('wamid.INT'), 'Confirmar')
    assert.equal(await get('wamid.BTN'), 'Quero saber mais')
    assert.equal(await get('wamid.WEIRD'), '[Mensagem não suportada]')
    assert.equal(await db.message.count({ where: { providerMessageId: 'wamid.REA' } }), 0)
  })
  it('BSUID: mensagem sem telefone cria contato com waUserId', async () => {
    const p = msgPayload(P1, W1, {
      contacts: [{ profile: { name: 'Sem Numero', username: 'semnumero' }, user_id: 'BR.13491208655302741918' }],
      messages: [{ from_user_id: 'BR.13491208655302741918', id: 'wamid.BSUID', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Olá do usuário' } }],
    })
    await hook(p)
    const m = await until(() => db.message.findFirst({ where: { providerMessageId: 'wamid.BSUID' }, include: { conversation: { include: { contact: true } } } }))
    assert.equal(m.conversation.contact.waUserId, 'BR.13491208655302741918')
    assert.equal(m.conversation.contact.telefone, null)
  })
  it('mídia: baixa pela Graph, guarda e marca ok (id da mídia só vem do webhook)', async () => {
    await gcfg({ media: { MEDIA_IN_1: { mime: 'image/png', dataB64: PNG.toString('base64') } } })
    const from = '5511911110003'
    const p = msgPayload(P1, W1, {
      contacts: [{ profile: { name: 'Cliente Foto' }, wa_id: from }],
      messages: [{ from, id: 'wamid.IMG1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'MEDIA_IN_1', mime_type: 'image/png', sha256: 'x', caption: 'Minha foto' } }],
    })
    await hook(p)
    const m = await until(async () => {
      const x = await db.message.findFirst({ where: { providerMessageId: 'wamid.IMG1' } })
      return x?.mediaStatus === 'ok' ? x : null
    })
    assert.equal(m.mediaType, 'image')
    assert.equal(m.body, '[Imagem] Minha foto')
    assert.equal(m.providerMediaId, 'MEDIA_IN_1')
    assert.ok(m.mediaKey)
    const log = await glog()
    const dl = log.find((l) => l.path === '/dl/MEDIA_IN_1')
    assert.ok(dl?.token, 'download com token')
  })
  it('status: enviada/entregue/lida, e falha com motivo', async () => {
    const conv = await db.conversation.findFirstOrThrow({ where: { workspaceId: A.workspaceId, contact: { telefone: '+5511911110001' } } })
    const out = await db.message.create({ data: { conversationId: conv.id, direction: 'OUT', author: 'USER', body: 'resp', status: 'ENVIADA', providerMessageId: 'wamid.OUT_ST_1' } })
    const st = (status: string, extra: Record<string, unknown> = {}) => msgPayload(P1, W1, { statuses: [{ id: 'wamid.OUT_ST_1', status, timestamp: '1', recipient_id: '5511911110001', ...extra }] })
    await hook(st('delivered'))
    await until(async () => (await db.message.findUniqueOrThrow({ where: { id: out.id } })).status === 'ENTREGUE')
    await hook(st('read'))
    await until(async () => (await db.message.findUniqueOrThrow({ where: { id: out.id } })).status === 'LIDA')
    await hook(st('delivered')) // atrasado não regride
    await sleep(500)
    assert.equal((await db.message.findUniqueOrThrow({ where: { id: out.id } })).status, 'LIDA')
    await hook(st('failed', { errors: [{ code: 131026, title: 'Message Undeliverable' }] }))
    const f = await until(async () => {
      const x = await db.message.findUniqueOrThrow({ where: { id: out.id } })
      return x.status === 'FALHOU' ? x : null
    })
    assert.match(f.failReason ?? '', /Message Undeliverable \(código 131026\)/)
  })
  it('eco do celular (smb_message_echoes): grava como resposta do dono e assume a conversa', async () => {
    const to = '5511911110004'
    await hook(msgPayload(P1, W1, { contacts: [{ profile: { name: 'Eco' }, wa_id: to }], messages: [{ from: to, id: 'wamid.ECO_IN', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'ola' } }] }))
    await until(() => db.message.findFirst({ where: { providerMessageId: 'wamid.ECO_IN' } }))
    const echo = msgPayload(P1, W1, { message_echoes: [{ from: '551100000000', to, id: 'wamid.ECO_1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Respondi pelo celular' } }] }, 'smb_message_echoes')
    await hook(echo)
    await hook(echo)
    const m0 = await until(() => db.message.findFirst({ where: { providerMessageId: 'wamid.ECO_1' }, include: { conversation: true } }))
    // a mensagem é gravada antes de registerManualReply passar a conversa para HUMANO: espera, não lê na hora
    const m = await until(async () => {
      const x = await db.message.findFirst({ where: { providerMessageId: 'wamid.ECO_1' }, include: { conversation: true } })
      return x && x.conversation.mode === 'HUMANO' ? x : null
    }, 10_000)
    assert.equal(m0.id, m.id)
    assert.equal(m.direction, 'OUT')
    assert.equal(m.author, 'USER')
    assert.equal(m.body, 'Respondi pelo celular')
    assert.equal(m.imported, false)
    assert.equal(m.conversation.mode, 'HUMANO')
    await sleep(400)
    assert.equal(await db.message.count({ where: { providerMessageId: 'wamid.ECO_1' } }), 1)
  })
  it('histórico da Coexistence: grava como importado, sem automações; recusa (2593109) é ignorada', async () => {
    const ts = Math.floor(Date.now() / 1000) - 3600 * 24 * 3
    const value = {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5511988880003', phone_number_id: P3 },
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [{ id: '5511922220001', messages: [
        { from: '5511922220001', to: '5511988880003', id: 'wamid.H1', timestamp: String(ts), type: 'text', text: { body: 'mensagem antiga do cliente' }, history_context: { status: 'READ' } },
        { from: '5511988880003', to: '5511922220001', id: 'wamid.H2', timestamp: String(ts + 60), type: 'text', text: { body: 'resposta antiga' }, history_context: { status: 'DELIVERED' } },
      ] }] }],
    }
    await hook({ object: 'whatsapp_business_account', entry: [{ id: W3, changes: [{ field: 'history', value }] }] })
    const h1 = await until(() => db.message.findFirst({ where: { providerMessageId: 'wamid.H1' } }))
    assert.equal(h1.imported, true)
    assert.equal(h1.direction, 'IN')
    const h2 = await db.message.findFirstOrThrow({ where: { providerMessageId: 'wamid.H2' } })
    assert.equal(h2.direction, 'OUT')
    assert.equal(h2.imported, true)
    const declined = { messaging_product: 'whatsapp', metadata: { phone_number_id: P3 }, history: [{ errors: [{ code: 2593109, title: 'History sync is turned off by the business from the WhatsApp Business App' }] }] }
    assert.equal((await hook({ object: 'whatsapp_business_account', entry: [{ id: W3, changes: [{ field: 'history', value: declined }] }] })).status, 200)
  })
  it('account_update: desconexão e restrição derrubam a sessão e desligam as automações', async () => {
    const ws = await makeUser()
    const wabaX = '1000000000090', phoneX = '2000000000090'
    await db.whatsAppSession.create({ data: { workspaceId: ws.workspaceId, provider: 'OFICIAL', status: 'CONECTADO', metaWabaId: wabaX, metaPhoneNumberId: phoneX, connectedAt: new Date() } })
    await db.aiAgent.upsert({ where: { workspaceId: ws.workspaceId }, create: { workspaceId: ws.workspaceId, enabled: true }, update: { enabled: true } })
    const upd = (event: string) => ({ object: 'whatsapp_business_account', entry: [{ id: wabaX, changes: [{ field: 'account_update', value: { event, waba_info: { waba_id: wabaX, owner_business_id: '9' } } }] }] })
    await hook(upd('PARTNER_REMOVED'))
    await until(async () => (await db.whatsAppSession.findUniqueOrThrow({ where: { workspaceId: ws.workspaceId } })).status === 'DESCONECTADO')
    await until(async () => !(await db.aiAgent.findUniqueOrThrow({ where: { workspaceId: ws.workspaceId } })).enabled)
    await db.whatsAppSession.update({ where: { workspaceId: ws.workspaceId }, data: { status: 'CONECTADO' } })
    await db.aiAgent.update({ where: { workspaceId: ws.workspaceId }, data: { enabled: true } })
    await hook(upd('ACCOUNT_RESTRICTION'))
    await until(async () => (await db.whatsAppSession.findUniqueOrThrow({ where: { workspaceId: ws.workspaceId } })).status === 'ERRO')
    await until(async () => !(await db.aiAgent.findUniqueOrThrow({ where: { workspaceId: ws.workspaceId } })).enabled)
  })
  it('message_template_status_update atualiza o modelo e o motivo', async () => {
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'modelo_webhook', category: 'UTILIDADE', status: 'EM_ANALISE', body: 'Texto do modelo de teste, ola', metaId: '777001' } })
    const ev = (event: string, reason?: string) => ({ object: 'whatsapp_business_account', entry: [{ id: W1, changes: [{ field: 'message_template_status_update', value: { event, message_template_id: '777001', message_template_name: 'modelo_webhook', message_template_language: 'pt_BR', ...(reason ? { reason } : {}) } }] }] })
    await hook(ev('REJECTED', 'INVALID_FORMAT'))
    const t = await until(async () => {
      const x = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name: 'modelo_webhook' } })
      return x.status === 'REJEITADO' ? x : null
    })
    assert.equal(t.rejectionReason, 'INVALID_FORMAT')
    await hook(ev('APPROVED'))
    const t2 = await until(async () => {
      const x = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name: 'modelo_webhook' } })
      return x.status === 'APROVADO' ? x : null
    })
    assert.equal(t2.rejectionReason, null)
  })
})

describe('4. envio', () => {
  const convOf = async (tel: string, ws = A.workspaceId) => db.conversation.findFirstOrThrow({ where: { workspaceId: ws, contact: { telefone: tel } } })

  it('texto com janela aberta: chama a Graph com appsecret_proof, grava ENVIADA e conta o uso', async () => {
    const conv = await convOf('+5511911110001')
    const before = await db.usageCounter.findMany({ where: { workspaceId: A.workspaceId } })
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const r = await api(ca, `/api/conversations/${conv.id}/messages`, { body: { body: 'Olá! Posso ajudar?', clientId: `cid-${uniq()}-abcd` } })
    assert.equal(r.status, 201, await r.clone().text())
    const m = (await r.json()) as { status: string }
    assert.equal(m.status, 'enviada')
    const log = (await glog()).filter((l) => l.path === `/v25.0/${P1}/messages`)
    assert.equal(log.length, 1)
    assert.equal(log[0]!.body.type, 'text')
    assert.equal(log[0]!.body.to, '5511911110001')
    assert.equal(log[0]!.body.text.body, 'Olá! Posso ajudar?')
    assert.equal(log[0]!.proofOk, true)
    const after = await db.usageCounter.findMany({ where: { workspaceId: A.workspaceId } })
    const sum = (rows: typeof after) => rows.reduce((a, b) => a + b.mensagensAtendimento, 0)
    assert.equal(sum(after), sum(before) + 1)
  })
  it('janela fechada (última do cliente há mais de 24 h): 422 FORA_DA_JANELA_24H sem chamar a Graph', async () => {
    const c = await db.contact.create({ data: { workspaceId: A.workspaceId, telefone: '+5511911119999', nome: 'Antigo' } })
    const conv = await db.conversation.create({ data: { workspaceId: A.workspaceId, contactId: c.id } })
    await db.message.create({ data: { conversationId: conv.id, direction: 'IN', author: 'CLIENTE', body: 'faz tempo', status: 'ENTREGUE', providerMessageId: 'wamid.OLD1', createdAt: new Date(Date.now() - 30 * 3600_000) } })
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const r = await api(ca, `/api/conversations/${conv.id}/messages`, { body: { body: 'oi', clientId: `cid-${uniq()}-abcd` } })
    assert.equal(r.status, 422)
    assert.equal(((await r.json()) as { code: string }).code, 'FORA_DA_JANELA_24H')
    assert.equal((await glog()).filter((l) => l.path.endsWith('/messages')).length, 0)
    const w = (await (await api(ca, `/api/conversations/${conv.id}/window`)).json()) as { open: boolean; provider: string }
    assert.equal(w.provider, 'oficial')
    assert.equal(w.open, false)
  })
  it('erro 131047 da Meta (janela vencida na ponta): 422 e nenhuma mensagem fica para trás', async () => {
    const c = await db.contact.create({ data: { workspaceId: A.workspaceId, telefone: '+5511000131047', nome: 'Janela Meta' } })
    const conv = await db.conversation.create({ data: { workspaceId: A.workspaceId, contactId: c.id } })
    await db.message.create({ data: { conversationId: conv.id, direction: 'IN', author: 'CLIENTE', body: 'recente', status: 'ENTREGUE', providerMessageId: 'wamid.REC1', createdAt: new Date() } })
    const r = await api(ca, `/api/conversations/${conv.id}/messages`, { body: { body: 'oi', clientId: `cid-${uniq()}-abcd` } })
    assert.equal(r.status, 422)
    assert.equal(((await r.json()) as { code: string }).code, 'FORA_DA_JANELA_24H')
    assert.equal(await db.message.count({ where: { conversationId: conv.id, direction: 'OUT' } }), 0)
  })
  it('imagem: upload em /media e envio por id com legenda', async () => {
    const conv = await convOf('+5511911110001')
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'foto.png')
    form.set('caption', 'Segue a foto')
    form.set('clientId', `cid-${uniq()}-abcd`)
    const r = await api(ca, `/api/conversations/${conv.id}/media`, { form })
    assert.equal(r.status, 201, await r.clone().text())
    const log = await glog()
    const up = log.find((l) => l.path === `/v25.0/${P1}/media`)
    assert.ok(up?.multipart, 'upload multipart')
    const send = log.find((l) => l.path === `/v25.0/${P1}/messages`)!
    assert.equal(send.body.type, 'image')
    assert.match(send.body.image.id, /^MEDIA_UP_/)
    assert.equal(send.body.image.caption, 'Segue a foto')
  })
  it('áudio ogg/opus: enviado como áudio por id (voz)', async () => {
    const conv = await convOf('+5511911110001')
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(OGG)], { type: 'audio/ogg; codecs=opus' }), 'voz.ogg')
    form.set('clientId', `cid-${uniq()}-abcd`)
    const r = await api(ca, `/api/conversations/${conv.id}/media`, { form })
    assert.equal(r.status, 201, await r.clone().text())
    const send = (await glog()).find((l) => l.path === `/v25.0/${P1}/messages`)!
    assert.equal(send.body.type, 'audio')
    assert.ok(send.body.audio.id)
    assert.equal(send.body.audio.caption, undefined)
  })
  it('modelo manual na janela fechada: GET window lista aprovados, POST envia o modelo com variáveis', async () => {
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'retorno_cliente', category: 'UTILIDADE', status: 'APROVADO', body: 'Oi {{1}}, seu pedido {{2}} saiu para entrega.', metaId: '777100', components: [{ type: 'BODY', text: 'Oi {{1}}, seu pedido {{2}} saiu para entrega.' }], exampleValues: ['Ana', '123'] } })
    const c = await db.contact.findFirstOrThrow({ where: { workspaceId: A.workspaceId, telefone: '+5511911119999' } })
    const conv = await db.conversation.findFirstOrThrow({ where: { contactId: c.id } })
    const w = (await (await api(ca, `/api/conversations/${conv.id}/window`)).json()) as { open: boolean; templates: Array<{ id: string; name: string; vars: number }>; firstName: string }
    const t = w.templates.find((x) => x.name === 'retorno_cliente')
    assert.ok(t)
    assert.equal(t.vars, 2)
    assert.equal(w.firstName, 'Antigo')
    // faltando variável: 400
    assert.equal((await api(ca, `/api/conversations/${conv.id}/template`, { body: { templateId: t.id, vars: ['Ana'] } })).status, 400)
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const r = await api(ca, `/api/conversations/${conv.id}/template`, { body: { templateId: t.id, vars: ['Ana', 'A-77'] } })
    assert.equal(r.status, 201, await r.clone().text())
    const send = (await glog()).find((l) => l.path === `/v25.0/${P1}/messages`)!
    assert.equal(send.body.type, 'template')
    assert.equal(send.body.template.name, 'retorno_cliente')
    assert.deepEqual(send.body.template.language, { code: 'pt_BR' })
    assert.deepEqual(send.body.template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'A-77' }] }])
    const m = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, direction: 'OUT' }, orderBy: { createdAt: 'desc' } })
    assert.equal(m.body, 'Oi Ana, seu pedido A-77 saiu para entrega.')
  })
  it('provedor.sendTemplate (motor): ajusta variáveis ao modelo; recusa não aprovado e "só no PearChat"', async () => {
    const p = new CloudApiProvider()
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'sem_variavel', category: 'MARKETING', status: 'APROVADO', body: 'Promoção da semana: tudo com 10% de desconto aqui.', metaId: '777101' } })
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'com_um_var', category: 'MARKETING', status: 'APROVADO', body: 'Oi {{1}}, temos uma promoção especial para você.', metaId: '777102' } })
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'so_local', category: 'MARKETING', status: 'APROVADO', body: 'Oi {{1}}, texto só local para teste.' } })
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'em_analise', category: 'MARKETING', status: 'EM_ANALISE', body: 'Oi {{1}}, texto em análise na Meta.', metaId: '777103' } })
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    await p.sendTemplate(A.workspaceId, { telefone: '+5511911110001' }, 'sem_variavel', ['Ana'])
    await p.sendTemplate(A.workspaceId, { telefone: '+5511911110001' }, 'com_um_var', ['Ana'])
    const sends = (await glog()).filter((l) => l.path === `/v25.0/${P1}/messages`)
    assert.equal(sends[0]!.body.template.components, undefined)
    assert.deepEqual(sends[1]!.body.template.components[0].parameters, [{ type: 'text', text: 'Ana' }])
    await assert.rejects(p.sendTemplate(A.workspaceId, { telefone: '+5511911110001' }, 'so_local', ['Ana']), /não está aprovado/)
    await assert.rejects(p.sendTemplate(A.workspaceId, { telefone: '+5511911110001' }, 'em_analise', ['Ana']), /não está aprovado/)
    assert.equal((await glog()).filter((l) => l.path === `/v25.0/${P1}/messages`).length, 2)
  })
  it('isolamento: outro workspace não vê janela nem envia na conversa alheia', async () => {
    const conv = await convOf('+5511911110001')
    assert.equal((await api(cout, `/api/conversations/${conv.id}/window`)).status, 404)
    assert.equal((await api(cout, `/api/conversations/${conv.id}/template`, { body: { templateId: 'x', vars: [] } })).status, 404)
  })
  it('token recusado (190): sessão vai para ERRO e as automações são desligadas', async () => {
    const conv = await convOf('+5511911110001')
    await db.aiAgent.upsert({ where: { workspaceId: A.workspaceId }, create: { workspaceId: A.workspaceId, enabled: true }, update: { enabled: true } })
    await gcfg({ tokens: { tok1: { valid: false, wabas: [W1] } } })
    const r = await api(ca, `/api/conversations/${conv.id}/messages`, { body: { body: 'oi', clientId: `cid-${uniq()}-abcd` } })
    assert.equal(r.status, 502)
    const row = await db.whatsAppSession.findUniqueOrThrow({ where: { workspaceId: A.workspaceId } })
    assert.equal(row.status, 'ERRO')
    assert.match(row.metaLastError ?? '', /Token recusado/)
    assert.equal((await db.aiAgent.findUniqueOrThrow({ where: { workspaceId: A.workspaceId } })).enabled, false)
    await gcfg({ tokens: { tok1: { valid: true, wabas: [W1] } } })
    await db.whatsAppSession.update({ where: { workspaceId: A.workspaceId }, data: { status: 'CONECTADO', metaLastError: null } })
  })
})

describe('5. modelos', () => {
  it('criar: valida e envia à Meta com exemplos; status em análise; metaId gravado', async () => {
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const r = await api(ca, '/api/templates', { body: { name: 'aviso_pedido', category: 'UTILIDADE', body: 'Olá {{1}}, seu pedido {{2}} foi confirmado com sucesso.', examples: ['Ana', 'A-1'] } })
    assert.equal(r.status, 201, await r.clone().text())
    const t = (await r.json()) as { status: string; onlyLocal: boolean; name: string; vars: number }
    assert.equal(t.status, 'EM_ANALISE')
    assert.equal(t.onlyLocal, false)
    assert.equal(t.vars, 2)
    const post = (await glog()).find((l) => l.method === 'POST' && l.path === `/v25.0/${W1}/message_templates`)!
    assert.equal(post.body.name, 'aviso_pedido')
    assert.equal(post.body.language, 'pt_BR')
    assert.equal(post.body.category, 'UTILITY')
    assert.deepEqual(post.body.components, [{ type: 'BODY', text: 'Olá {{1}}, seu pedido {{2}} foi confirmado com sucesso.', example: { body_text: [['Ana', 'A-1']] } }])
    assert.equal(post.proofOk, true)
    const row = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name: 'aviso_pedido' } })
    assert.ok(row.metaId)
    assert.deepEqual(row.exampleValues, ['Ana', 'A-1'])
  })
  it('recusas locais: nome inválido (400), sem exemplo, variável no início, no fim, não sequencial, duplicado (409)', async () => {
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const post = (body: Record<string, unknown>) => api(ca, '/api/templates', { body: { category: 'MARKETING', examples: [], ...body } })
    assert.equal((await post({ name: 'Nome Inválido!', body: 'texto qualquer aqui' })).status, 400)
    assert.equal((await post({ name: 'sem_exemplo', body: 'Oi {{1}}, tudo bem por aí?' })).status, 422)
    assert.equal((await post({ name: 'var_inicio', body: '{{1}}, tudo bem por aí hoje?', examples: ['Ana'] })).status, 422)
    assert.equal((await post({ name: 'var_fim', body: 'Tudo bem por aí hoje, {{1}}', examples: ['Ana'] })).status, 422)
    assert.equal((await post({ name: 'var_pulo', body: 'Oi {{1}}, o pedido {{3}} chegou hoje.', examples: ['Ana', 'x', 'y'] })).status, 422)
    assert.equal((await post({ name: 'aviso_pedido', body: 'Outro texto {{1}} para o mesmo nome.', examples: ['Ana'] })).status, 409)
    assert.equal((await glog()).filter((l) => l.path.endsWith('/message_templates')).length, 0)
  })
  it('a Meta recusa (nome duplicado lá): erro 422 com a mensagem da Meta e fbtrace_id', async () => {
    await gcfg({ templates: { [W1]: [{ id: '9990', name: 'ja_existe_na_meta', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Texto ja existente por aqui' }] }] } })
    const r = await api(ca, '/api/templates', { body: { name: 'ja_existe_na_meta', category: 'UTILIDADE', body: 'Texto novo para o mesmo nome aqui.', examples: [] } })
    // não existe localmente (ainda não sincronizado) -> vai à Meta, que recusa
    assert.equal(r.status, 422)
    const e = ((await r.json()) as { error: string }).error
    assert.match(e, /Já existe um modelo com esse nome e idioma/)
    assert.match(e, /fbtrace_id TRACE_100/)
  })
  it('sincronizar com estados variados; "Só no PearChat" para locais que a Meta não conhece', async () => {
    await db.template.create({ data: { workspaceId: A.workspaceId, name: 'seed_aprovado_local', category: 'MARKETING', status: 'APROVADO', body: 'Oi {{1}}, modelo do seed que não existe na Meta.' } })
    const comp = (t: string) => [{ type: 'BODY', text: t, example: { body_text: [['Ana']] } }]
    await gcfg({
      templates: {
        [W1]: [
          { id: '9101', name: 'meta_aprovado', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED', components: comp('Oi {{1}}, novidade da semana na loja.') },
          { id: '9102', name: 'meta_pendente', language: 'pt_BR', category: 'UTILITY', status: 'PENDING', components: comp('Oi {{1}}, estamos conferindo seu pedido.') },
          { id: '9103', name: 'meta_rejeitado', language: 'pt_BR', category: 'MARKETING', status: 'REJECTED', rejected_reason: 'INCORRECT_CATEGORY', components: comp('Oi {{1}}, aproveite hoje mesmo as ofertas.') },
          { id: '9104', name: 'meta_pausado', language: 'pt_BR', category: 'MARKETING', status: 'PAUSED', components: comp('Oi {{1}}, temos novidades para você hoje.') },
          { id: '9105', name: 'meta_desativado', language: 'pt_BR', category: 'UTILITY', status: 'DISABLED', components: comp('Oi {{1}}, seu agendamento está confirmado.') },
          { id: '9106', name: 'meta_auth', language: 'pt_BR', category: 'AUTHENTICATION', status: 'APPROVED', components: comp('Seu código é {{1}}') },
          { id: '9108', name: 'meta_duas_vars', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Oi {{1}}, seu pedido {{2}} está a caminho.', example: { body_text: [['Ana', '12']] } }] },
          { id: '9107', name: 'meta_header_midia', language: 'pt_BR', category: 'MARKETING', status: 'APPROVED', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Oi {{1}}, veja a foto da promoção.' }] },
        ],
      },
    })
    const r = await api(ca, '/api/templates/sync', { method: 'POST' })
    assert.equal(r.status, 200, await r.clone().text())
    const list = (await r.json()) as Array<{ name: string; status: string; rejectionReason?: string | null; onlyLocal: boolean; unsupported?: string | null }>
    const by = (n: string) => list.find((x) => x.name === n)!
    assert.equal(by('meta_aprovado').status, 'APROVADO')
    assert.equal(by('meta_pendente').status, 'EM_ANALISE')
    assert.equal(by('meta_rejeitado').status, 'REJEITADO')
    assert.equal(by('meta_rejeitado').rejectionReason, 'INCORRECT_CATEGORY')
    assert.equal(by('meta_pausado').status, 'PAUSADO')
    assert.equal(by('meta_desativado').status, 'DESATIVADO')
    assert.equal(list.find((x) => x.name === 'meta_auth'), undefined)
    assert.match(by('meta_header_midia').unsupported ?? '', /cabeçalho/)
    assert.equal(by('seed_aprovado_local').onlyLocal, true)
    assert.equal(by('seed_aprovado_local').status, 'EM_ANALISE') // nunca foi aprovado por ninguém
    assert.equal(by('meta_aprovado').onlyLocal, false)
    // modelo local com metaId que a Meta não lista mais vira "Só no PearChat"
    assert.equal(by('modelo_webhook').onlyLocal, true)
  })
  it('disparo oficial: recusa não aprovado, "só no PearChat", mais de uma variável; aceita aprovado com {{1}}', async () => {
    await db.contact.create({ data: { workspaceId: A.workspaceId, telefone: '+5511933330001', nome: 'Para Disparo' } })
    const camp = async (name: string) => {
      const t = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name } })
      return api(ca, '/api/campaigns', { body: { lista: 'todos', templateId: t.id, quando: 'agora', intervalo: '5-10' } })
    }
    assert.equal((await camp('meta_pendente')).status, 409)
    assert.equal((await camp('meta_rejeitado')).status, 409)
    assert.equal((await camp('meta_pausado')).status, 409)
    assert.equal((await camp('seed_aprovado_local')).status, 409)
    assert.equal((await camp('meta_duas_vars')).status, 422) // duas variáveis
    assert.equal((await camp('meta_header_midia')).status, 422)
    const ok = await camp('meta_aprovado')
    assert.equal(ok.status, 201, await ok.clone().text())
  })
  it('excluir: remove na Meta (hsm_id + name) e no banco; "só no PearChat" não chama a Graph', async () => {
    const t = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name: 'meta_pausado' } })
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    const r = await api(ca, `/api/templates/${t.id}`, { method: 'DELETE' })
    assert.equal(r.status, 200, await r.clone().text())
    const del = (await glog()).find((l) => l.method === 'DELETE')!
    assert.equal(del.path, `/v25.0/${W1}/message_templates`)
    assert.equal(del.query.hsm_id, '9104')
    assert.equal(del.query.name, 'meta_pausado')
    assert.equal(await db.template.count({ where: { id: t.id } }), 0)
    const local = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name: 'seed_aprovado_local' } })
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    assert.equal((await api(ca, `/api/templates/${local.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await glog()).filter((l) => l.method === 'DELETE').length, 0)
  })
  it('enviar um "Só no PearChat" para aprovação (POST com id)', async () => {
    const t = await db.template.create({ data: { workspaceId: A.workspaceId, name: 'local_para_enviar', category: 'MARKETING', status: 'EM_ANALISE', body: 'Oi {{1}}, veja nossas novidades da semana.' } })
    const r = await api(ca, '/api/templates', { body: { id: t.id, category: 'MARKETING', body: t.body, examples: ['Ana'] } })
    assert.equal(r.status, 201, await r.clone().text())
    const row = await db.template.findUniqueOrThrow({ where: { id: t.id } })
    assert.ok(row.metaId)
  })
  it('isolamento: outro workspace não lista nem exclui os modelos', async () => {
    const t = await db.template.findFirstOrThrow({ where: { workspaceId: A.workspaceId, name: 'meta_aprovado' } })
    assert.equal((await api(cout, `/api/templates/${t.id}`, { method: 'DELETE' })).status, 404)
    const list = (await (await api(cout, '/api/templates')).json()) as Array<{ id: string }>
    assert.ok(!list.some((x) => x.id === t.id))
    // sem conexão oficial: criar cai no modelo local (conexão rápida), sem chamar a Graph
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    assert.equal((await api(cout, '/api/templates', { body: { name: 'meu_local', category: 'MARKETING', body: 'Oi {{1}}, texto local qualquer.', examples: [] } })).status, 201)
    assert.equal((await glog()).length, 0)
  })
})

describe('6. cadastro hospedado pela Meta', () => {
  it('PARTNER_ADDED vira evento pendente; "Já concluí" só reivindica com o número certo; evento é de uso único', async () => {
    await db.whatsAppSession.update({ where: { workspaceId: A2.workspaceId }, data: { metaPhoneNumberId: null, status: 'DESCONECTADO' } })
    const st = ((await (await api(ca2, '/api/wa/embedded-signup/start', { body: { mode: 'hosted' } })).json()) as { state: string }).state
    // nada pendente ainda
    let r = await api(ca2, '/api/wa/embedded-signup/hosted/check', { body: { state: st, numero: '+55 11 97777-0005' } })
    assert.deepEqual(await r.json(), { status: 'waiting' })
    // webhook da Meta: o cliente terminou o cadastro hospedado
    const ev = { object: 'whatsapp_business_account', entry: [{ id: '5550001', time: 1, changes: [{ field: 'account_update', value: { event: 'PARTNER_ADDED', waba_info: { waba_id: W5, owner_business_id: B5, solution_id: '1' } } }] }] }
    assert.equal((await hook(ev)).status, 200)
    await until(() => db.metaPartnerEvent.findFirst({ where: { wabaId: W5, claimedAt: null } }))
    // número diferente: continua aguardando (outro cliente não leva o cadastro)
    r = await api(ca2, '/api/wa/embedded-signup/hosted/check', { body: { state: st, numero: '+55 11 90000-1111' } })
    assert.deepEqual(await r.json(), { status: 'waiting' })
    await fetch(`${GRAPH}/__reset`, { method: 'POST' })
    r = await api(ca2, '/api/wa/embedded-signup/hosted/check', { body: { state: st, numero: '+55 11 97777-0005' } })
    assert.equal(r.status, 200, await r.clone().text())
    const j = (await r.json()) as { status: string; dto: { numero: string; status: string } }
    assert.equal(j.status, 'connected')
    assert.equal(j.dto.numero, '+55 11 97777-0005')
    const log = await glog()
    const tokReq = log.find((l) => l.path === `/v25.0/${B5}/system_user_access_tokens`)!
    assert.equal(tokReq.query.fetch_only, 'true')
    assert.equal(tokReq.token, 'system-token-de-teste')
    assert.equal(tokReq.proofOk, true)
    // número já CONNECTED na Meta: não registra
    assert.ok(!log.some((l) => l.path.endsWith('/register')))
    // state e evento de uso único
    r = await api(ca2, '/api/wa/embedded-signup/hosted/check', { body: { state: st, numero: '+55 11 97777-0005' } })
    assert.equal(r.status, 403)
    const row = await db.whatsAppSession.findUniqueOrThrow({ where: { workspaceId: A2.workspaceId } })
    assert.equal(row.metaPhoneNumberId, P5)
    assert.equal((await db.metaPartnerEvent.findFirstOrThrow({ where: { wabaId: W5 } })).claimedByWorkspace, A2.workspaceId)
  })
})
