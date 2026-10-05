// Onda 1: corpo limitado, IP do cliente, Origin (CSRF), limites de taxa e tetos. Rode com: node test-env.mjs -- npx tsx --test tests/security/limits.test.ts
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { cleanup, makeAccount, randomIp, uniq } from './helpers'
import { BodyTooLargeError, hasBadText, readBytesLimited, readJson, readJsonLimited, readTextLimited } from '../../src/server/http/body'
import { apiGuardVerdict, bodyLimitFor, sameOrigin } from '../../src/server/http/api-guard'
import { clientIpFromHeaders, normalizeIp } from '../../src/server/security/hash'
import { consume, DAY, HOUR, hitCaps, markSuccess, reserve } from '../../src/server/security/rate-limit'
import { registerAccount, REGISTER_GLOBAL_PER_HOUR } from '../../src/server/auth/register'
import { db } from '../../src/lib/db'

after(cleanup)

/** Requisição "chunked": sem content-length, corpo em pedaços (o caso que o content-length não pega). */
function chunkedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch)
      c.close()
    },
  })
  return new Request('http://localhost/x', { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit & { duplex: 'half' })
}
const bytes = (n: number) => new Uint8Array(n).fill(97)

describe('corpo com limite de tamanho (item 7)', () => {
  it('JSON dentro do limite passa; inválido é 400', async () => {
    const ok = await readJsonLimited(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 1 }) }))
    assert.deepEqual(ok, { ok: true, body: { a: 1 } })
    const bad = await readJsonLimited(new Request('http://localhost/x', { method: 'POST', body: '{nao-json' }))
    assert.deepEqual(bad, { ok: false, status: 400 })
  })

  it('declarado grande demais: 413 sem ler', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } })
    assert.deepEqual(await readJsonLimited(req, 1000), { ok: false, status: 413 })
  })

  it('ATAQUE: corpo chunked (sem content-length) é cortado no limite, sem carregar tudo', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++
        c.enqueue(bytes(64 * 1024))
        if (pulled > 200) c.close() // "10 MB" prometidos; nunca deve chegar lá
      },
    })
    const req = new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' })
    assert.equal(req.headers.get('content-length'), null)
    const r = await readJsonLimited(req, 128 * 1024)
    assert.deepEqual(r, { ok: false, status: 413 })
    assert.ok(pulled < 10, `leu ${pulled} pedaços antes de cortar (esperado poucos)`)
  })

  it('readBytesLimited/readTextLimited lançam BodyTooLargeError e leem o que cabe', async () => {
    await assert.rejects(readBytesLimited(chunkedRequest([bytes(600), bytes(600)]), 1000), BodyTooLargeError)
    assert.equal((await readTextLimited(chunkedRequest([bytes(10)]), 100)).length, 10)
  })

  it('readJson (substituto das rotas autenticadas): null para quebrado, grande ou com NUL', async () => {
    assert.equal(await readJson(new Request('http://localhost/x', { method: 'POST', body: '{ruim' })), null)
    assert.equal(await readJson(chunkedRequest([bytes(2000)]), 1000), null)
    assert.equal(await readJson(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 'x\u0000y' }) })), null)
    assert.deepEqual(await readJson(new Request('http://localhost/x', { method: 'POST', body: '{"a":"ok"}' })), { a: 'ok' })
    assert.equal(hasBadText({ a: ['\uD800'] }), true)
  })

  it('limites por rota no middleware: padrão 1 MB, uploads maiores só onde precisa', () => {
    assert.equal(bodyLimitFor('/api/settings'), 1024 * 1024)
    assert.ok(bodyLimitFor('/api/conversations/abc/media') > 16 * 1024 * 1024)
    assert.ok(bodyLimitFor('/api/contacts/import') > 8 * 1024 * 1024)
    assert.ok(bodyLimitFor('/api/me/avatar') < 4 * 1024 * 1024)
  })
})

describe('CSRF por Origin (item 9)', () => {
  const mk = (method: string, headers: Record<string, string>, path = '/api/settings') => ({
    method,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    nextUrl: { pathname: path },
  })

  it('mesma origem e clientes sem Origin passam; GET nunca é barrado', () => {
    assert.equal(apiGuardVerdict(mk('POST', { host: 'pearchat.online', origin: 'https://pearchat.online' })), null)
    assert.equal(apiGuardVerdict(mk('PUT', { host: 'pearchat.online' })), null)
    assert.equal(apiGuardVerdict(mk('GET', { host: 'pearchat.online', origin: 'https://evil.example' })), null)
  })

  it('ATAQUE: POST de outro site (Origin diferente, "null" ou Sec-Fetch-Site cross-site) é 403', () => {
    assert.equal(apiGuardVerdict(mk('POST', { host: 'pearchat.online', origin: 'https://evil.example' }))?.status, 403)
    assert.equal(apiGuardVerdict(mk('DELETE', { host: 'pearchat.online', origin: 'null' }))?.status, 403)
    assert.equal(apiGuardVerdict(mk('POST', { host: 'pearchat.online', 'sec-fetch-site': 'cross-site' }))?.status, 403)
    // subdomínio irmão também NÃO vale (é exatamente o caso que o SameSite não cobre)
    assert.equal(apiGuardVerdict(mk('POST', { host: 'pearchat.online', origin: 'https://blog.pearchat.online' }))?.status, 403)
  })

  it('atrás do proxy: X-Forwarded-Host e o endereço público configurado valem', () => {
    assert.equal(sameOrigin('https://pearchat.online', { headers: { get: (n) => ({ host: '127.0.0.1:3000', 'x-forwarded-host': 'pearchat.online' })[n] ?? null } }, []), true)
    assert.equal(sameOrigin('https://pearchat.online', { headers: { get: () => null } }, ['https://pearchat.online']), true)
  })

  it('corpo declarado acima do limite da rota: 413', () => {
    assert.equal(apiGuardVerdict(mk('POST', { host: 'a', 'content-length': String(2 * 1024 * 1024) }))?.status, 413)
    assert.equal(apiGuardVerdict(mk('POST', { host: 'a', 'content-length': String(2 * 1024 * 1024) }, '/api/me/avatar')), null)
  })
})

describe('IP do cliente atrás do Caddy (item 4)', () => {
  const h = (xff?: string, real?: string) => ({ get: (n: string) => (n === 'x-forwarded-for' ? (xff ?? null) : n === 'x-real-ip' ? (real ?? null) : null) })

  it('usa a ÚLTIMA entrada do x-forwarded-for (a que o Caddy acrescentou); entradas forjadas à esquerda são ignoradas', () => {
    assert.equal(clientIpFromHeaders(h('1.2.3.4, 9.9.9.9, 203.0.113.7')), '203.0.113.7')
    assert.equal(clientIpFromHeaders(h('203.0.113.7')), '203.0.113.7')
    assert.equal(clientIpFromHeaders(h(undefined, '198.51.100.2')), '198.51.100.2')
    assert.equal(clientIpFromHeaders(h()), 'local')
  })

  it('IPv6 vira o prefixo /64 (rotacionar o final do endereço não escapa do limite); IPv4 mapeado vira IPv4', () => {
    const a = normalizeIp('2001:db8:aaaa:bbbb:1111:2222:3333:4444')
    const b = normalizeIp('2001:db8:aaaa:bbbb:ffff:eeee:dddd:cccc')
    assert.equal(a, b)
    assert.notEqual(a, normalizeIp('2001:db8:aaaa:cccc::1'))
    assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9')
    assert.equal(normalizeIp('2001:db8::1'), normalizeIp('2001:0db8:0:0::99'))
  })
})

describe('login: o bloqueio por e-mail não tranca o dono (B1)', () => {
  const T0 = Date.UTC(2026, 9, 5, 12, 0, 0)

  it('ATAQUE: 5 erros de um IP bloqueiam SÓ esse IP; o dono, de outro IP, continua entrando', async () => {
    const email = `b1-${uniq()}@teste.local`
    const atacante = randomIp()
    const dono = randomIp()
    for (let i = 0; i < 5; i++) assert.equal((await reserve('login', { email, ip: atacante }, T0 + i)).blocked, false)
    assert.equal((await reserve('login', { email, ip: atacante }, T0 + 10)).blocked, true)
    assert.equal((await reserve('login', { email, ip: dono }, T0 + 20)).blocked, false)
  })

  it('ataque distribuído (muitos IPs) ainda bloqueia o e-mail acima de 50 falhas; sucesso zera', async () => {
    const email = `b1d-${uniq()}@teste.local`
    for (let i = 0; i < 50; i++) assert.equal((await reserve('login', { email, ip: `10.200.${Math.floor(i / 250)}.${i % 250}` }, T0 + i)).blocked, false)
    assert.equal((await reserve('login', { email, ip: '10.201.0.1' }, T0 + 100)).blocked, true)
    await markSuccess('login', { email, ip: '10.201.0.2' }, T0 + 200)
    assert.equal((await reserve('login', { email, ip: '10.201.0.3' }, T0 + 300)).blocked, false)
  })
})

describe('tetos nomeados (hitCaps)', () => {
  it('conta cada uso e bloqueia acima do máximo; o uso bloqueado não é gravado; dois tetos juntos', async () => {
    const key = `k-${uniq()}`
    const caps = [
      { name: 'teste-hora', key, max: 3, windowMs: HOUR },
      { name: 'teste-dia', key, max: 5, windowMs: DAY },
    ]
    for (let i = 0; i < 3; i++) assert.deepEqual(await hitCaps(caps), { blocked: false })
    const r = await hitCaps(caps)
    assert.equal(r.blocked, true)
    if (r.blocked) {
      assert.equal(r.cap, 'teste-hora')
      assert.ok(r.retryAfter >= 1 && r.retryAfter <= 3600)
    }
    // o bloqueado não gastou nada: com o teto horário maior, ainda cabem exatamente os 2 do dia que sobravam
    const so_dia = [{ name: 'teste-dia', key, max: 5, windowMs: DAY }]
    assert.equal((await hitCaps(so_dia)).blocked, false) // 4º do dia
    assert.equal((await hitCaps(so_dia)).blocked, false) // 5º do dia
    assert.equal((await hitCaps(so_dia)).blocked, true) // 6º
  })

  it('chaves diferentes não se misturam e só HMAC fica no banco', async () => {
    const a = `a-${uniq()}`
    assert.equal((await hitCaps([{ name: 'iso', key: a, max: 1, windowMs: HOUR }])).blocked, false)
    assert.equal((await hitCaps([{ name: 'iso', key: a, max: 1, windowMs: HOUR }])).blocked, true)
    assert.equal((await hitCaps([{ name: 'iso', key: `b-${uniq()}`, max: 1, windowMs: HOUR }])).blocked, false)
    const rows = await db.loginAttempt.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })
    for (const r of rows) assert.match(r.emailHash, /^[0-9a-f]{64}$/)
  })
})

describe('cadastro: limites por IP, por e-mail e global (M3)', () => {
  const novo = () => ({ nome: 'Fulana de Tal', email: `reg-${uniq()}@teste.local`, password: 'Senha-Forte-1234' })

  it('caminho feliz cria organização + espaço + dono; e-mail repetido é recusado', async () => {
    const ip = randomIp()
    const dados = novo()
    const r = await registerAccount(dados, ip)
    assert.deepEqual(r, { ok: true })
    const u = await db.user.findUniqueOrThrow({ where: { email: dados.email } })
    assert.equal(u.papel, 'owner')
    assert.equal(u.emailVerified, null)
    assert.ok(u.organizationId)
    const dup = await registerAccount({ ...dados, nome: 'Outra' }, randomIp())
    assert.equal(dup.ok, false)
    if (!dup.ok) assert.equal(dup.kind, 'email_taken')
    // limpeza
    await db.user.delete({ where: { id: u.id } })
    await db.workspace.delete({ where: { id: u.workspaceId } })
    await db.organization.delete({ where: { id: u.organizationId! } })
  })

  it('ATAQUE: o 6º cadastro do mesmo IP na hora é bloqueado (5 por IP por hora)', async () => {
    const ip = randomIp()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const d = novo()
      const r = await registerAccount(d, ip)
      assert.equal(r.ok, true, `cadastro ${i + 1}`)
      const u = await db.user.findUniqueOrThrow({ where: { email: d.email }, select: { id: true, workspaceId: true, organizationId: true } })
      ids.push(u.id)
      await db.user.delete({ where: { id: u.id } })
      await db.workspace.delete({ where: { id: u.workspaceId } })
      await db.organization.delete({ where: { id: u.organizationId! } })
    }
    const sexto = await registerAccount(novo(), ip)
    assert.equal(sexto.ok, false)
    if (!sexto.ok) {
      assert.equal(sexto.kind, 'blocked')
      assert.ok(sexto.retryAfter > 0)
    }
    // outro IP segue podendo (o bloqueio é por IP)
    const outro = novo()
    assert.equal((await registerAccount(outro, randomIp())).ok, true)
    const u = await db.user.findUniqueOrThrow({ where: { email: outro.email } })
    await db.user.delete({ where: { id: u.id } })
    await db.workspace.delete({ where: { id: u.workspaceId } })
    await db.organization.delete({ where: { id: u.organizationId! } })
  })

  it('ATAQUE: a mesma caixa de e-mail não recebe mais de 3 pedidos por hora (mesmo de IPs diferentes)', async () => {
    const email = `alvo-${uniq()}@teste.local`
    const dono = await makeAccount({ email, verified: true }) // e-mail já tem conta: cada tentativa vira "já existe", mas conta no limite
    for (let i = 0; i < 3; i++) {
      const r = await registerAccount({ nome: 'Alguém', email, password: 'Senha-Forte-1234' }, randomIp())
      assert.equal(r.ok === false && r.kind, 'email_taken')
    }
    const quarto = await registerAccount({ nome: 'Alguém', email, password: 'Senha-Forte-1234' }, randomIp())
    assert.equal(quarto.ok === false && quarto.kind, 'blocked')
    assert.ok(dono.id)
  })

  it('teto GLOBAL: acima do máximo por hora o cadastro fica indisponível (qualquer IP)', async () => {
    assert.ok(REGISTER_GLOBAL_PER_HOUR >= 100)
    // enche o balde global à mão (HMAC do mesmo nome/chave que o cadastro usa) e confere o bloqueio sem criar 200 contas
    const { hmac } = await import('../../src/server/security/hash')
    const emailHash = hmac('cap:register-global-hour', 'all')
    const ipHash = hmac('cap-slot', 'x')
    await db.loginAttempt.createMany({ data: Array.from({ length: REGISTER_GLOBAL_PER_HOUR }, () => ({ emailHash, ipHash, sucesso: false })) })
    const r = await registerAccount(novo(), randomIp())
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.kind, 'unavailable')
    // limpa o balde global para não afetar a próxima rodada
    await db.loginAttempt.deleteMany({ where: { emailHash } })
  })

  it('consume(register) guarda só hash e respeita a janela de 1 hora', async () => {
    const ip = randomIp()
    const email = `w-${uniq()}@teste.local`
    const t0 = Date.now()
    for (let i = 0; i < 3; i++) assert.equal((await consume('register', { email, ip }, t0 + i)).blocked, false)
    assert.equal((await consume('register', { email, ip }, t0 + 10)).blocked, true)
    assert.equal((await consume('register', { email, ip }, t0 + 61 * 60_000)).blocked, false)
  })
})
