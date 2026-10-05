// Onda 1 (revisão), ponto 2: conferência de Origin (CSRF) x clientes que não são navegador e variações da origem do app. HTTP.
// Contra o servidor de TESTE (TEST_BASE_URL, porta 3048); sem a variável os testes são pulados.
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { cleanup, makeAccount, uniq } from './helpers'
import { APP_ORIGIN, BASE, call, login, rawRequest } from './http-helpers'
import { db } from '../../src/lib/db'

const suite = BASE ? describe : describe.skip

after(cleanup)

suite('B4: conferência de Origin x clientes que não são navegador e variações da origem do app', () => {
  let cookie = ''
  let body = ''
  const put = (headers: Record<string, string>) =>
    rawRequest(BASE!, 'PUT', '/api/settings', { cookie, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...headers }, body)

  it('prepara a conta', async () => {
    const u = await makeAccount({ verified: true })
    cookie = await login(u)
    const cur = (await (await call(cookie, 'GET', '/api/settings')).json()) as Record<string, unknown>
    body = JSON.stringify(cur)
  })

  it('SEM Origin e sem Sec-Fetch-Site (scripts de servidor, validate.mjs, monitor) a escrita é PERMITIDA (vale a autenticação por cookie)', async () => {
    assert.equal((await put({})).status, 200)
    assert.equal((await put({ 'sec-fetch-site': 'none' })).status, 200)
    assert.equal((await put({ 'sec-fetch-site': 'same-origin' })).status, 200)
  })

  it('o que o validador de publicação faz: POST /api/wa/disconnect e /api/wa/connect (fetch do Node, sem Origin) não são barrados', async () => {
    const d = await call(cookie, 'POST', '/api/wa/disconnect')
    assert.ok(![401, 403, 413].includes(d.status), `disconnect: HTTP ${d.status}`)
    const c = await call(cookie, 'POST', '/api/wa/connect', { provider: 'rapida' })
    assert.ok(![401, 403, 413].includes(c.status), `connect: HTTP ${c.status}`)
  })

  it('variações LEGÍTIMAS da origem passam: AUTH_URL, maiúsculas e barra final, Host de produção, porta padrão explícita, www., X-Forwarded-Host', async () => {
    const casos: Array<[string, Record<string, string>]> = [
      ['AUTH_URL', { origin: APP_ORIGIN }],
      ['maiúsculas e barra final', { origin: 'HTTP://ONDA1A.LOCALHOST:3048/' }],
      ['Host de produção (Caddy repassa o Host)', { host: 'pearchat.online', origin: 'https://pearchat.online' }],
      ['porta padrão explícita (:443)', { host: 'pearchat.online', origin: 'https://pearchat.online:443' }],
      ['Origin em maiúsculas', { host: 'pearchat.online', origin: 'https://PEARCHAT.ONLINE' }],
      ['www. repassado pelo proxy', { host: 'www.pearchat.online', origin: 'https://www.pearchat.online' }],
      ['X-Forwarded-Host do proxy', { host: '127.0.0.1:3048', 'x-forwarded-host': 'pearchat.online', origin: 'https://pearchat.online' }],
    ]
    for (const [nome, h] of casos) assert.equal((await put(h)).status, 200, nome)
  })

  it('ATAQUE: outra origem, sufixo/prefixo enganoso, subdomínio irmão, Origin "null" e cross-site sem Origin são 403', async () => {
    const casos: Array<[string, Record<string, string>]> = [
      ['outro site', { origin: 'https://evil.example' }],
      ['sufixo enganoso', { host: 'pearchat.online', origin: 'https://pearchat.online.evil.example' }],
      ['prefixo enganoso', { host: 'pearchat.online', origin: 'https://evilpearchat.online' }],
      ['subdomínio irmão', { host: 'pearchat.online', origin: 'https://blog.pearchat.online' }],
      ['www. quando o Host é o domínio puro', { host: 'pearchat.online', origin: 'https://www.pearchat.online' }],
      ['Origin null', { origin: 'null' }],
      ['Sec-Fetch-Site cross-site sem Origin', { 'sec-fetch-site': 'cross-site' }],
    ]
    for (const [nome, h] of casos) {
      const r = await put(h)
      assert.equal(r.status, 403, nome)
      assert.match(r.text, /Origem não permitida/)
    }
  })

  it('login por credenciais, entrada com Google, saída e o link público de agendamento NÃO passam pela conferência (têm a proteção própria)', async () => {
    const guard = /Origem não permitida/
    const anon = { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }
    for (const path of ['/api/auth/callback/credentials', '/api/auth/signin/google', '/api/auth/signout']) {
      const r = await rawRequest(BASE!, 'POST', path, anon, 'csrfToken=x')
      assert.doesNotMatch(r.text, guard, path) // quem responde é o Auth.js (token CSRF próprio), não esta conferência
    }
    const acc = await makeAccount({ verified: true })
    const slug = `t-${uniq()}`
    await db.workspace.update({ where: { id: acc.workspaceId }, data: { slug, bookingAtivo: true } })
    const pub = await rawRequest(BASE!, 'POST', `/api/public/booking/${slug}`, { origin: 'https://evil.example', 'content-type': 'application/json' }, '{}')
    assert.doesNotMatch(pub.text, guard, 'agendamento público (anônimo)')
    assert.notEqual(pub.status, 403)
    const page = await rawRequest(BASE!, 'GET', `/a/${slug}`, {})
    assert.equal(page.status, 200)
  })
})

// ---------------------------------------------------------------------------------------------------------------
