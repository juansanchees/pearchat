// Onda 1, de ponta a ponta (HTTP): contra um servidor de TESTE já no ar (schema pearchat_test_a, porta 3048).
// Sem TEST_BASE_URL os testes são pulados. Exemplo (dois modos de e-mail; veja tests/security/account.test.ts):
//   node test-env.mjs [--mail] -- npm start            (em outro terminal, depois de `npm run build`)
//   TEST_BASE_URL=http://127.0.0.1:3048 node test-env.mjs [--mail] -- npx tsx --test tests/security/http.test.ts
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { cleanup, makeAccount, MAIL_ON, randomIp, uniq, type TestUser } from './helpers'
import { db } from '../../src/lib/db'
import { issueEmailCode } from '../../src/server/mail/email-verification'
import { AGENT_TEST_PER_USER_HOUR } from '../../src/server/agent/limits'

const BASE = process.env.TEST_BASE_URL
const suite = BASE ? describe : describe.skip
const APP_ORIGIN = 'http://onda1a.localhost:3048' // = AUTH_URL do lançador

after(cleanup)

type Res = { status: number; headers: Headers; json: () => Promise<Record<string, unknown>>; text: () => Promise<string> }

/** Login por senha pela API do Auth.js. Tenta de novo se o servidor de teste (conexões do banco = 2) estiver ocupado. */
async function login(u: TestUser): Promise<string> {
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

const call = (cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie, ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }) as Promise<Res>

function chunked(totalBytes: number, headers: Record<string, string> = {}): RequestInit {
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

suite('M4: corpo grande em rotas ANÔNIMAS é cortado (413), mesmo "chunked"', () => {
  it('redefinição de senha: corpo declarado grande e corpo chunked sem content-length', async () => {
    const declared = await fetch(`${BASE}/api/auth/password/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', x: 'y'.repeat(40_000) }) })
    assert.equal(declared.status, 413)
    const ch = await fetch(`${BASE}/api/auth/password/request`, chunked(2 * 1024 * 1024))
    assert.equal(ch.status, 413)
    const reset = await fetch(`${BASE}/api/auth/password/reset`, chunked(2 * 1024 * 1024))
    assert.equal(reset.status, 413)
  })

  it('pedido pequeno e válido continua sendo respondido (resposta neutra, 200)', async () => {
    const r = await fetch(`${BASE}/api/auth/password/request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': randomIp() }, body: JSON.stringify({ email: `nao-existe-${uniq()}@teste.local` }) })
    assert.equal(r.status, 200)
  })

  it('webhook da Meta: corpo chunked acima do teto é recusado antes de qualquer conferência', async () => {
    const r = await fetch(`${BASE}/api/wa/meta`, chunked(9 * 1024 * 1024))
    assert.equal(r.status, 413)
  })

  it('link público de agendamento: corpo acima de 4 KB é 413 (declarado ou chunked)', async () => {
    const acc = await makeAccount({ verified: true })
    const slug = `t-${uniq()}`
    await db.workspace.update({ where: { id: acc.workspaceId }, data: { slug, bookingAtivo: true } })
    const a = await fetch(`${BASE}/api/public/booking/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'x'.repeat(10_000) }) })
    assert.equal(a.status, 413)
    const b = await fetch(`${BASE}/api/public/booking/${slug}`, chunked(1024 * 1024))
    assert.equal(b.status, 413)
  })
})

suite('conta existente: entra, usa o app e é protegida na API', () => {
  it('login por senha, perfil, CSRF por Origin, corpo grande e troca de e-mail pelo PUT de perfil', async () => {
    const u = await makeAccount({ verified: true })
    const cookie = await login(u)

    const me = await call(cookie, 'GET', '/api/settings')
    assert.equal(me.status, 200)
    const cur = (await me.json()) as { email: string; nome: string; empresa: string; horarioAtendimento: string; notifs: unknown[] }
    assert.equal(cur.email, u.email)

    // A1: o PUT de perfil não troca o e-mail (400), mesmo logado; com o mesmo e-mail, salva.
    const trocar = await call(cookie, 'PUT', '/api/settings', { ...cur, email: `atacante-${uniq()}@teste.local` })
    assert.equal(trocar.status, 400)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
    const ok = await call(cookie, 'PUT', '/api/settings', { ...cur, nome: 'Nome Novo' })
    assert.equal(ok.status, 200)

    // B4: POST/PUT de outro site é barrado mesmo com o cookie (Origin e Sec-Fetch-Site).
    const evil = await call(cookie, 'PUT', '/api/settings', { ...cur, nome: 'Invasor' }, { origin: 'https://evil.example' })
    assert.equal(evil.status, 403)
    const cross = await call(cookie, 'PUT', '/api/settings', { ...cur, nome: 'Invasor' }, { 'sec-fetch-site': 'cross-site' })
    assert.equal(cross.status, 403)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).nome, 'Nome Novo', 'nada mudou')
    const same = await call(cookie, 'PUT', '/api/settings', { ...cur, nome: 'Mesma Origem' }, { origin: APP_ORIGIN })
    assert.equal(same.status, 200)

    // M4: JSON autenticado acima do limite: 413.
    const big = await call(cookie, 'PUT', '/api/settings', JSON.stringify({ ...cur, empresa: 'e'.repeat(400_000) }))
    assert.equal(big.status, 413)
  })

  it('a troca de e-mail por POST /api/me/email: indisponível sem serviço de e-mail; com ele, exige a senha', async () => {
    const u = await makeAccount({ verified: true })
    const cookie = await login(u)
    const st = (await (await call(cookie, 'GET', '/api/me/email')).json()) as { disponivel: boolean; temSenha: boolean }
    assert.equal(st.disponivel, MAIL_ON)
    assert.equal(st.temSenha, true)
    const novo = `novo-${uniq()}@teste.local`
    const wrong = await call(cookie, 'POST', '/api/me/email', { action: 'request', email: novo, password: 'senha-errada-qualquer' })
    assert.equal(wrong.status, MAIL_ON ? 400 : 503)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
  })

  it('B2: ativar o 2FA exige a senha atual; sem a senha ou com a senha errada, nada é gerado', async () => {
    const u = await makeAccount({ verified: true })
    const cookie = await login(u)
    assert.equal((await call(cookie, 'POST', '/api/security/2fa', { action: 'setup' })).status, 400)
    assert.equal((await call(cookie, 'POST', '/api/security/2fa', { action: 'setup', password: 'senha-errada-qualquer' })).status, 400)
    const ok = await call(cookie, 'POST', '/api/security/2fa', { action: 'setup', password: u.password })
    assert.equal(ok.status, 200)
    assert.ok(((await ok.json()) as { secret?: string }).secret)
  })

  it('B7: sessão de usuário que não existe mais deixa de valer (falha fechada)', async () => {
    const u = await makeAccount({ verified: true })
    const cookie = await login(u)
    assert.equal((await call(cookie, 'GET', '/api/settings')).status, 200)
    await db.verificationToken.deleteMany({ where: { identifier: { contains: u.id } } })
    await db.user.delete({ where: { id: u.id } })
    await new Promise((r) => setTimeout(r, 2600)) // o espaço ativo fica em cache por até 2 s (ACTIVE_SPACE_CACHE_MS)
    const after = await call(cookie, 'GET', '/api/settings')
    assert.equal(after.status, 401)
  })
})

suite('A4/M6: "Testar o agente" no servidor', () => {
  const payload = { mensagem: 'Oi, vocês atendem sábado?' }

  it('conta existente usa; teto por usuário devolve 429 com Retry-After; corpo acima de 32 KB é 413', async () => {
    const u = await makeAccount({ verified: true })
    const cookie = await login(u)
    const big = await call(cookie, 'POST', '/api/agent/test', JSON.stringify({ mensagem: 'oi', prompt: 'p'.repeat(40_000) }))
    assert.equal(big.status, 413)
    for (let i = 0; i < AGENT_TEST_PER_USER_HOUR; i++) {
      const r = await call(cookie, 'POST', '/api/agent/test', payload)
      assert.equal(r.status, 200, `chamada ${i + 1}`)
      if (i === 0) assert.equal(((await r.json()) as { simulado?: boolean }).simulado, true, 'sem chave de IA: resposta simulada, sem custo')
    }
    const over = await call(cookie, 'POST', '/api/agent/test', payload)
    assert.equal(over.status, 429)
    assert.ok(Number(over.headers.get('retry-after')) >= 1)
  })

  it('ATAQUE: conta nova sem e-mail confirmado (com código pendente) é barrada quando há serviço de e-mail; sem serviço, segue como hoje', async () => {
    const u = await makeAccount({ verified: false })
    const cookie = await login(u)
    if (MAIL_ON) await issueEmailCode({ id: u.id, email: u.email, nome: 'Teste' }) // o que o cadastro faz
    const r = await call(cookie, 'POST', '/api/agent/test', payload)
    if (MAIL_ON) {
      assert.equal(r.status, 403)
      assert.equal(((await r.json()) as { code?: string }).code, 'EMAIL_NAO_VERIFICADO')
      // as telas de verificação seguem funcionando para quem está bloqueado
      assert.equal((await call(cookie, 'GET', '/api/me/email')).status, 200)
    } else {
      assert.equal(r.status, 200, 'sem e-mail configurado a verificação não é exigida: criar conta e usar continuam possíveis')
    }
  })

  it('conta ANTIGA sem e-mail verificado (sem código pendente) continua usando o app', async () => {
    const u = await makeAccount({ verified: false })
    const cookie = await login(u)
    const r = await call(cookie, 'POST', '/api/agent/test', payload)
    assert.equal(r.status, 200)
  })

  it('sem sessão: 401, e o limite de IP/Origin não vaza informação', async () => {
    const r = await fetch(`${BASE}/api/agent/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(r.status, 401)
  })
})
