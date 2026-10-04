// Testes HTTP contra o servidor de TESTE em http://localhost:3032 (schema pearchat_test_e). Uso: tsx --test tests/http.test.ts
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../src/lib/db'
import { totpAt } from '../src/server/security/totp'
import { beginSetup, confirmSetup } from '../src/server/security/mfa'
import { primaryLogin } from '../src/server/security/login'

const BASE = process.env.TEST_BASE ?? 'http://localhost:3032'
assert.equal(new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema'), 'pearchat_test_e')

const uniq = () => randomBytes(5).toString('hex')
const created: string[] = []
async function makeUser() {
  const email = `h-${uniq()}@teste.local`
  const u = await db.user.create({ data: { nome: 'Teste HTTP', email, passwordHash: await bcrypt.hash('Senha-Forte-1', 4), workspace: { create: { nome: 'Teste HTTP' } } } })
  created.push(u.id)
  return { id: u.id, email, password: 'Senha-Forte-1' }
}
after(async () => {
  for (const id of created) {
    const u = await db.user.findUnique({ where: { id }, select: { workspaceId: true } })
    await db.user.delete({ where: { id } }).catch(() => undefined)
    if (u) await db.workspace.delete({ where: { id: u.workspaceId } }).catch(() => undefined)
  }
  await db.$disconnect()
})

const cookieJar = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ')

/** Login pelo endpoint de credenciais do Auth.js (o mesmo que o formulário usa por baixo). */
async function credentialsLogin(fields: Record<string, string>, ip = `192.0.2.${Math.floor(Math.random() * 250)}`) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const csrfCookie = cookieJar(csrfRes)
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie, 'x-forwarded-for': ip },
    body: new URLSearchParams({ csrfToken, ...fields }).toString(),
  })
  const set = res.headers.getSetCookie().find((c) => /authjs\.session-token=[^;]+/.test(c))
  return { res, session: set ? set.split(';')[0] : null, location: res.headers.get('location') ?? '' }
}
const me = (cookie?: string) => fetch(`${BASE}/api/me`, { headers: cookie ? { cookie } : {}, redirect: 'manual' })

describe('página inicial e arquivos públicos', () => {
  it('/ sem sessão: 200 com o conteúdo e cabeçalhos de segurança', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' })
    assert.equal(res.status, 200)
    const html = await res.text()
    assert.match(html, /Seu WhatsApp atendendo, agendando e vendendo por você/)
    assert.match(html, /A cobrança ainda não está ativa/)
    assert.match(html, /INFODREAMZ NEGOCIOS DIGITAIS LTDA/)
    assert.match(html, /application\/ld\+json/)
    assert.match(html, /og:image/)
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
    assert.match(res.headers.get('permissions-policy') ?? '', /camera=\(\)/)
  })
  it('/ com sessão redireciona ao app', async () => {
    const u = await makeUser()
    const { session } = await credentialsLogin({ email: u.email, password: u.password })
    assert.ok(session)
    const res = await fetch(`${BASE}/`, { headers: { cookie: session }, redirect: 'manual' })
    assert.ok([307, 308].includes(res.status))
    assert.match(res.headers.get('location') ?? '', /\/whatsapp$/)
  })
  it('sitemap.xml e robots.txt', async () => {
    const sm = await (await fetch(`${BASE}/sitemap.xml`)).text()
    assert.match(sm, /<urlset/)
    assert.match(sm, /\/privacidade<\/loc>/)
    assert.match(sm, /\/termos<\/loc>/)
    const rb = await fetch(`${BASE}/robots.txt`)
    assert.equal(rb.status, 200)
    const t = await rb.text()
    assert.match(t, /Allow: \/\n/)
    assert.match(t, /Disallow: \/api\//)
    assert.match(t, /Disallow: \/a\//)
    assert.match(t, /Sitemap: .*\/sitemap\.xml/)
  })
  it('app sem sessão continua protegido', async () => {
    assert.equal((await me()).status, 401)
    const r = await fetch(`${BASE}/whatsapp`, { redirect: 'manual' })
    assert.match(r.headers.get('location') ?? '', /\/login/)
  })
})

describe('sessão, 2FA e limite no endpoint real', () => {
  it('"sair de todos os dispositivos" invalida o cookie antigo', async () => {
    const u = await makeUser()
    const { session } = await credentialsLogin({ email: u.email, password: u.password })
    assert.ok(session)
    assert.equal((await me(session)).status, 200)
    const other = (await credentialsLogin({ email: u.email, password: u.password })).session
    assert.ok(other)
    const del = await fetch(`${BASE}/api/security/sessions`, { method: 'DELETE', headers: { cookie: session } })
    assert.equal(del.status, 200)
    assert.equal((await me(session)).status, 401)
    assert.equal((await me(other)).status, 401) // o outro dispositivo também caiu
    const fresh = (await credentialsLogin({ email: u.email, password: u.password })).session
    assert.equal((await me(fresh ?? undefined)).status, 200) // novo login volta a valer
  })

  it('com 2FA ativo, só o primeiro fator NÃO cria sessão; com o segundo, sim', async () => {
    const u = await makeUser()
    const setup = await beginSetup(u.id)
    const t = Date.now()
    await confirmSetup(u.id, totpAt(setup.secret, t), t)

    // Senha certa pelo endpoint de credenciais: nenhuma sessão.
    const first = await credentialsLogin({ email: u.email, password: u.password })
    assert.equal(first.session, null)
    assert.equal((await me()).status, 401)
    // O cookie do desafio (pc_mfa) também não abre nenhuma rota.
    const ch = await primaryLogin(u.email, u.password, '198.51.100.9', { delay: false })
    assert.equal(ch.kind, 'mfa')
    if (ch.kind !== 'mfa') return
    assert.equal((await me(`pc_mfa=${ch.challenge}`)).status, 401)
    assert.equal((await fetch(`${BASE}/api/security/2fa`, { headers: { cookie: `pc_mfa=${ch.challenge}` } })).status, 401)
    const page = await fetch(`${BASE}/whatsapp`, { headers: { cookie: `pc_mfa=${ch.challenge}` }, redirect: 'manual' })
    assert.match(page.headers.get('location') ?? '', /\/login/)

    // Código errado no segundo passo: sem sessão. Código certo: sessão.
    const bad = await credentialsLogin({ challenge: ch.challenge, code: '000000' })
    assert.equal(bad.session, null)
    // O passo da ativação já foi consumido (anti-reuso); o passo seguinte ainda cabe na tolerância de ±1.
    const good = await credentialsLogin({ challenge: ch.challenge, code: totpAt(setup.secret, t + 30_000) })
    assert.ok(good.session)
    assert.equal((await me(good.session)).status, 200)
  })

  it('6ª tentativa de senha errada vira "muitas tentativas" (e a conta certa também fica bloqueada)', async () => {
    const u = await makeUser()
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`
    for (let i = 0; i < 5; i++) {
      const r = await credentialsLogin({ email: u.email, password: `errada-${i}` }, ip)
      assert.equal(r.session, null)
      assert.doesNotMatch(r.location, /rate_limited/)
    }
    const blocked = await credentialsLogin({ email: u.email, password: `errada-6` }, ip)
    assert.match(blocked.location, /rate_limited/)
    const right = await credentialsLogin({ email: u.email, password: u.password }, ip)
    assert.equal(right.session, null) // bloqueado mesmo com a senha certa
    assert.match(right.location, /rate_limited/)
  })
})
