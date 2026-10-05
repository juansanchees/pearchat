// Sininho: testes das ROTAS contra o servidor de TESTE (build de produção na porta 3041, schema pearchat_test_e). Uso:
//   node .claude/tmp/sininho/test-env.mjs npx tsx --test tests/notifications/http.test.ts   (com o servidor no ar)
import { cleanup, db, makeWorld, ago, seedAiJob, seedConv, SENHA } from './fixtures'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

const BASE = process.env.TEST_BASE ?? 'http://localhost:3041'

after(cleanup)

const cookieJar = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ')

/** Login pelo endpoint de credenciais do Auth.js (o mesmo que o formulário usa por baixo). */
async function login(email: string): Promise<string> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieJar(csrfRes), 'x-forwarded-for': `192.0.2.${Math.floor(Math.random() * 250)}` },
    body: new URLSearchParams({ csrfToken, email, password: SENHA }).toString(),
  })
  const set = res.headers.getSetCookie().find((c) => /authjs\.session-token=[^;]+/.test(c))
  assert.ok(set, 'login de teste falhou')
  return set.split(';')[0]
}

const call = (cookie: string | null, path: string, init: RequestInit & { json?: unknown } = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  })

describe('rotas /api/notifications', () => {
  it('sem sessão: 401 em todas', async () => {
    for (const [method, path] of [['POST', '/api/notifications/sync'], ['POST', '/api/notifications/heartbeat'], ['GET', '/api/notifications'], ['DELETE', '/api/notifications'], ['POST', '/api/notifications/read'], ['DELETE', '/api/notifications/abc']] as const) {
      const r = await call(null, path, { method, json: method === 'POST' ? {} : undefined })
      assert.equal(r.status, 401, `${method} ${path}`)
    }
  })

  it('sync: valida o corpo, não aceita usuário/espaço do cliente e responde sem cache', async () => {
    const w = await makeWorld()
    const dono = await login(w.owner.email)
    const ok = await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, tela: 'conversas' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    const corpo = (await ok.json()) as { naoLidas: number; itens: unknown[]; ausenteDesde: string | null }
    assert.equal(typeof corpo.naoLidas, 'number')
    assert.ok(Array.isArray(corpo.itens))
    // Campos que o cliente NÃO pode mandar
    for (const extra of [{ workspaceId: w.w2.id }, { userId: w.admin.id }, { organizationId: w.org.id }]) {
      assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, ...extra } })).status, 400)
    }
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: 'sim' } })).status, 400)
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, tela: '/etc/passwd' } })).status, 400)
    // Content-Type errado e corpo grande demais
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', body: '{"visivel":true}', headers: { 'content-type': 'text/plain' } })).status, 415)
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, lixo: 'x'.repeat(6000) } })).status, 413)
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', body: '{nao json', headers: { 'content-type': 'application/json' } })).status, 400)
  })

  it('convenções da onda 1A: Origin de outro site = 403 (sem Origin e com a própria origem passam); corpo de 300 KB = 413 no middleware', async () => {
    const w = await makeWorld()
    const dono = await login(w.owner.email)
    const rotas = [['POST', '/api/notifications/sync', { visivel: true }], ['POST', '/api/notifications/heartbeat', undefined], ['POST', '/api/notifications/read', {}], ['DELETE', '/api/notifications/abc', undefined], ['DELETE', '/api/notifications', undefined]] as const
    for (const [method, path, json] of rotas) {
      const fora = await call(dono, path, { method, json, headers: { origin: 'https://site-malicioso.example' } })
      assert.equal(fora.status, 403, `${method} ${path} com Origin de outro site`)
      const cross = await call(dono, path, { method, json, headers: { 'sec-fetch-site': 'cross-site' } })
      assert.equal(cross.status, 403, `${method} ${path} com Sec-Fetch-Site cross-site e sem Origin`)
    }
    // A própria origem (o que o navegador manda) e sem Origin (cliente que não é navegador) seguem normalmente
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: false }, headers: { origin: new URL(BASE).origin } })).status, 200)
    assert.equal((await call(dono, '/api/notifications/heartbeat', { method: 'POST', headers: { origin: new URL(BASE).origin } })).status, 200)
    // Leitura (GET) nunca depende da Origin
    assert.equal((await call(dono, '/api/notifications', { headers: { origin: 'https://site-malicioso.example' } })).status, 200)
    // 300 KB declarados: o middleware responde 413 antes da rota; 5 KB: a rota (teto de 4 KB) responde 413
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, lixo: 'x'.repeat(300 * 1024) } })).status, 413)
    assert.equal((await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, lixo: 'x'.repeat(5000) } })).status, 413)
  })

  it('espaço e usuário SEMPRE da sessão: ?workspaceId= é ignorado; ids alheias dão 404', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    // A dona tem uma notificação no W1 e outra no W2; o administrador tem uma no W1
    const mk = (userId: string, workspaceId: string, titulo: string) =>
      db.notification.create({ data: { userId, workspaceId, tipo: 'followup', titulo, dedupeKey: `t:${titulo}`, ocorridoEm: ago(2, agora) } })
    const doW1 = await mk(w.owner.id, w.w1.id, 'dona-w1')
    await mk(w.owner.id, w.w2.id, 'dona-w2')
    const doAdmin = await mk(w.admin.id, w.w1.id, 'admin-w1')
    const dono = await login(w.owner.email)
    const lista = (await (await call(dono, `/api/notifications?workspaceId=${w.w2.id}&userId=${w.admin.id}`)).json()) as { itens: { titulo: string }[] }
    assert.deepEqual(lista.itens.map((i) => i.titulo), ['dona-w1'])
    // Ids de outro usuário (mesmo espaço) e de outro espaço (mesmo usuário): 404, e nada some
    assert.equal((await call(dono, `/api/notifications/${doAdmin.id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await call(dono, '/api/notifications/read', { method: 'POST', json: { ids: [doAdmin.id] } })).status, 404)
    const doW2 = await db.notification.findFirstOrThrow({ where: { userId: w.owner.id, workspaceId: w.w2.id } })
    assert.equal((await call(dono, `/api/notifications/${doW2.id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await call(dono, '/api/notifications/read', { method: 'POST', json: { ids: ['../x'] } })).status, 400)
    assert.equal(await db.notification.count({ where: { id: { in: [doAdmin.id, doW2.id] }, apagadaEm: null } }), 2)
    // A própria: lê, apaga e a segunda vez dá 404
    assert.equal((await call(dono, '/api/notifications/read', { method: 'POST', json: { ids: [doW1.id] } })).status, 200)
    assert.equal((await call(dono, `/api/notifications/${doW1.id}`, { method: 'DELETE' })).status, 200)
    assert.equal((await call(dono, `/api/notifications/${doW1.id}`, { method: 'DELETE' })).status, 404)
  })

  it('atendente sem acesso a um espaço não lê as notificações dele (nem pedindo)', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    // O atendente só é membro do W1; existe uma linha dele no W2 (de quando tinha acesso)
    await db.notification.create({ data: { userId: w.agent.id, workspaceId: w.w2.id, tipo: 'followup', titulo: 'do-w2', dedupeKey: 'k2', ocorridoEm: ago(2, agora) } })
    await db.notification.create({ data: { userId: w.agent.id, workspaceId: w.w1.id, tipo: 'followup', titulo: 'do-w1', dedupeKey: 'k1', ocorridoEm: ago(2, agora) } })
    const atendente = await login(w.agent.email)
    const l = (await (await call(atendente, `/api/notifications?workspaceId=${w.w2.id}`)).json()) as { itens: { titulo: string }[] }
    assert.deepEqual(l.itens.map((i) => i.titulo), ['do-w1'])
    // Mesmo tentando trocar de espaço para o W2, o servidor recusa e a sessão continua no W1
    const troca = await call(atendente, '/api/spaces/switch', { method: 'POST', json: { workspaceId: w.w2.id } })
    assert.ok([400, 403, 404].includes(troca.status), `troca de espaço: ${troca.status}`)
    const depois = (await (await call(atendente, '/api/notifications')).json()) as { itens: { titulo: string }[] }
    assert.deepEqual(depois.itens.map((i) => i.titulo), ['do-w1'])
  })

  it('sync completo pela rota: gera, lista, lê, apaga e limpa', async () => {
    const w = await makeWorld()
    const agora = Date.now()
    const { conv } = await seedConv(w.w1.id, { nome: 'Teresa', mode: 'IA', ultimaMin: 20 }, agora)
    await seedAiJob(w.w1.id, conv.id, { runMin: 20 }, agora)
    const dono = await login(w.owner.email)
    const sync = (await (await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: true, tela: 'outra' } })).json()) as { naoLidas: number; itens: { id: string; titulo: string; link: string | null }[] }
    assert.equal(sync.itens[0].titulo, 'A IA respondeu Teresa')
    assert.match(sync.itens[0].link ?? '', /^\/whatsapp\?c=/)
    assert.equal(sync.naoLidas, 1)
    assert.equal((await call(dono, '/api/notifications/read', { method: 'POST', json: {} })).status, 200)
    const l = (await (await call(dono, '/api/notifications?limite=5')).json()) as { naoLidas: number; itens: unknown[]; proximo: string | null }
    assert.equal(l.naoLidas, 0)
    assert.equal(l.proximo, null)
    assert.equal((await call(dono, '/api/notifications?antes=lixo')).status, 400)
    assert.equal((await call(dono, '/api/notifications?limite=1000')).status, 400)
    assert.equal((await call(dono, '/api/notifications/heartbeat', { method: 'POST' })).status, 200)
    const limpa = (await (await call(dono, '/api/notifications', { method: 'DELETE' })).json()) as { apagadas: number }
    assert.equal(limpa.apagadas, 1)
    const vazia = (await (await call(dono, '/api/notifications')).json()) as { itens: unknown[] }
    assert.equal(vazia.itens.length, 0)
  })

  it('limite de taxa: o sync passa de 20 por minuto e devolve 429 com Retry-After', async () => {
    const w = await makeWorld()
    const dono = await login(w.owner.email)
    let primeiro429: Response | null = null
    for (let i = 0; i < 25 && !primeiro429; i++) {
      const r = await call(dono, '/api/notifications/sync', { method: 'POST', json: { visivel: false } })
      if (r.status === 429) primeiro429 = r
      else assert.equal(r.status, 200)
    }
    assert.ok(primeiro429, 'esperava 429 até a 25ª chamada')
    assert.ok(Number(primeiro429.headers.get('retry-after')) > 0)
    // Outro usuário não é afetado
    const adm = await login(w.admin.email)
    assert.equal((await call(adm, '/api/notifications/sync', { method: 'POST', json: { visivel: false } })).status, 200)
  })
})
