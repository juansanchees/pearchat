// Onda 1 (revisão), ponto 1: banco fora do ar x resposta definitiva do banco na releitura da sessão (B7 refinado). HTTP, ponta a ponta.
// TEST_BASE_URL = servidor de TESTE (porta 3048, com banco); TEST_BASE_URL_NODB = 2º servidor com o banco INALCANÇÁVEL (porta 3049):
//   node .claude/tmp/onda1a/serve.mjs --nodb. Sem as variáveis os testes são pulados. Os casos sem servidor estão em session.test.ts.
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { cleanup, makeAccount } from './helpers'
import { BASE, NODB, call, login } from './http-helpers'
import { db } from '../../src/lib/db'

const suite = BASE ? describe : describe.skip
const suiteNoDb = BASE && NODB ? describe : describe.skip

after(cleanup)

const settle = () => new Promise((r) => setTimeout(r, 2600)) // o espaço ativo fica em cache por até 2 s (ACTIVE_SPACE_CACHE_MS)
/** O cookie de sessão foi APAGADO (valor vazio, Max-Age=0 ou data no passado)? Renovar o prazo (Set-Cookie com o mesmo token) não conta. */
const clears = (headers: Headers | Record<string, string | string[] | undefined>) => {
  const list = headers instanceof Headers ? headers.getSetCookie() : [headers['set-cookie']].flat().filter((x): x is string => !!x)
  return list.some((c) => /session-token=(;|$)/.test(c) || /max-age=0/i.test(c) || (/session-token/.test(c) && /expires=[^;]*1970/i.test(c)))
}

// ---------------------------------------------------------------------------------------------------------------
suiteNoDb('B7: erro de infraestrutura na releitura da sessão = 503 (sessão mantida, ação NÃO autorizada)', () => {
  it('APIs respondem 503 + Retry-After curto, sem apagar o cookie; telas não vão ao login; a mesma sessão volta a valer com o banco no ar', async () => {
    const u = await makeAccount({ verified: true })
    const cookie = await login(u) // no servidor COM banco
    const json = { 'content-type': 'application/json', cookie }

    for (const [method, path, body] of [
      ['GET', '/api/settings', undefined],
      ['GET', '/api/me', undefined],
      ['GET', '/api/sidebar', undefined],
      ['GET', '/api/wa/status', undefined],
      ['GET', '/api/conversations', undefined],
      ['PUT', '/api/settings', JSON.stringify({ nome: 'Invasor', email: u.email, empresa: 'X', horarioAtendimento: 'x', notifs: [] })],
      ['POST', '/api/agent/test', JSON.stringify({ mensagem: 'oi' })],
      ['POST', '/api/wa/disconnect', undefined],
    ] as const) {
      const r = await fetch(`${NODB}${path}`, { method, headers: json, body })
      assert.equal(r.status, 503, `${method} ${path}`)
      const retry = Number(r.headers.get('retry-after'))
      assert.ok(retry >= 1 && retry <= 5, `Retry-After curto em ${path}`)
      assert.equal(((await r.json()) as { code?: string }).code, 'INDISPONIVEL')
      assert.equal(clears(r.headers), false, 'o cookie de sessão NÃO é apagado')
    }

    // Tela do app: nem redireciona ao /login nem à "sessão encerrada"; o cookie segue valendo.
    const page = await fetch(`${NODB}/whatsapp`, { headers: { cookie }, redirect: 'manual' })
    assert.equal(page.headers.get('location'), null, 'sem redirecionamento')
    assert.ok(page.status >= 500, `tela de "tente de novo" (HTTP ${page.status}), não login`)
    assert.equal(clears(page.headers), false)

    // A sessão continua válida: o servidor com banco aceita o MESMO cookie (nada foi invalidado, nada foi alterado).
    const ok = await call(cookie, 'GET', '/api/settings')
    assert.equal(ok.status, 200)
    assert.equal(((await ok.json()) as { nome: string }).nome, 'Teste Segurança', 'o PUT sem sessão utilizável não gravou nada')
  })
})

suite('B7: resposta DEFINITIVA do banco = 401 (e não 503)', () => {
  it('usuário desativado, "sair de todos os dispositivos" e usuário apagado encerram a sessão', async () => {
    const off = await makeAccount({ verified: true })
    const c1 = await login(off)
    assert.equal((await call(c1, 'GET', '/api/settings')).status, 200)
    await db.user.update({ where: { id: off.id }, data: { desativadoEm: new Date() } })

    const ver = await makeAccount({ verified: true })
    const c2 = await login(ver)
    assert.equal((await call(c2, 'GET', '/api/settings')).status, 200)
    await db.user.update({ where: { id: ver.id }, data: { sessionVersion: { increment: 1 } } })

    const gone = await makeAccount({ verified: true })
    const c3 = await login(gone)
    assert.equal((await call(c3, 'GET', '/api/settings')).status, 200)
    await db.verificationToken.deleteMany({ where: { identifier: { contains: gone.id } } })
    await db.user.delete({ where: { id: gone.id } })

    await settle()
    for (const [nome, cookie] of [['desativado', c1], ['versão de sessão diferente', c2], ['apagado', c3]] as const) {
      const r = await call(cookie, 'GET', '/api/settings')
      assert.equal(r.status, 401, nome)
      assert.equal(r.headers.get('retry-after'), null, `${nome}: não é "tente de novo"`)
      assert.notEqual(((await r.json()) as { code?: string }).code, 'INDISPONIVEL')
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------
