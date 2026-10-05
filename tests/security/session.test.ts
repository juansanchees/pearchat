// Sessão x banco fora do ar (B7 refinado): erro de infraestrutura NÃO invalida a sessão nem autoriza (503), resposta definitiva do
// banco invalida (401). Sem banco: roda em qualquer ambiente (node --test). O teste de ponta a ponta está em http.test.ts.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  RETRY_AFTER_S,
  clearSessionCheckFailure,
  judgeSession,
  markSessionCheckFailed,
  sessionCheckRecentlyFailed,
  unauthorizedResponse,
  unavailableResponse,
} from '../../src/server/auth/availability'
import { unauthorized as unauthorizedMessages } from '../../src/server/messages/api'
import { unauthorized as unauthorizedSettings } from '../../src/server/settings/http'

afterEach(clearSessionCheckFailure)

const active = (over: Partial<{ sessionVersion: number; blocked: boolean }> = {}) => ({
  workspaceId: 'w1',
  organizationId: 'o1',
  papel: 'owner',
  sessionVersion: 3,
  blocked: false,
  ...over,
})

class PrismaLikeError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'PrismaClientKnownRequestError'
  }
}

describe('judgeSession: erro de infraestrutura x resposta definitiva do banco', () => {
  it('banco respondeu e está tudo certo: ok', async () => {
    const v = await judgeSession(async () => active(), 3)
    assert.equal(v.kind, 'ok')
  })

  it('ERRO de infraestrutura (timeout, pool esgotado, banco inalcançável, qualquer exceção): unavailable, NUNCA invalid', async () => {
    for (const err of [
      new PrismaLikeError('P2024', 'Timed out fetching a new connection from the connection pool'),
      new PrismaLikeError('P1001', "Can't reach database server at `x:5432`"),
      new PrismaLikeError('P2028', 'Transaction API error: Transaction already closed'),
      Object.assign(new Error('connect ECONNREFUSED'), { name: 'PrismaClientInitializationError' }),
      new Error('qualquer outra falha ao ler'),
    ]) {
      const v = await judgeSession(async () => Promise.reject(err), 3)
      assert.equal(v.kind, 'unavailable', String(err))
    }
  })

  it('RESPOSTA definitiva: usuário inexistente, desativado/sem espaço liberado ou versão de sessão diferente = invalid', async () => {
    assert.equal((await judgeSession(async () => null, 3)).kind, 'invalid')
    assert.equal((await judgeSession(async () => active({ blocked: true }), 3)).kind, 'invalid')
    assert.equal((await judgeSession(async () => active({ sessionVersion: 4 }), 3)).kind, 'invalid')
    assert.equal((await judgeSession(async () => active({ sessionVersion: 0 }), 3)).kind, 'invalid')
  })

  it('a sessão continua válida na chamada seguinte, quando o banco volta (nada foi invalidado)', async () => {
    let up = false
    const resolve = async () => {
      if (!up) throw new PrismaLikeError('P1001', "Can't reach database server")
      return active()
    }
    assert.equal((await judgeSession(resolve, 3)).kind, 'unavailable')
    up = true
    assert.equal((await judgeSession(resolve, 3)).kind, 'ok')
  })
})

describe('respostas das rotas sem sessão utilizável', () => {
  it('sem falha recente de leitura: 401 "Não autenticado" (sessão realmente ausente/revogada)', async () => {
    assert.equal(sessionCheckRecentlyFailed(), false)
    for (const fn of [unauthorizedResponse, unauthorizedMessages, unauthorizedSettings]) {
      const r = fn()
      assert.equal(r.status, 401)
      assert.equal(r.headers.get('retry-after'), null)
    }
  })

  it('logo após falha de infraestrutura: 503 + Retry-After curto + código INDISPONIVEL, em TODOS os helpers das rotas', async () => {
    markSessionCheckFailed()
    assert.equal(sessionCheckRecentlyFailed(), true)
    for (const fn of [unauthorizedResponse, unauthorizedMessages, unauthorizedSettings, unavailableResponse]) {
      const r = fn()
      assert.equal(r.status, 503)
      assert.equal(r.headers.get('retry-after'), String(RETRY_AFTER_S))
      assert.ok(Number(r.headers.get('retry-after')) <= 5, 'Retry-After curto')
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.equal(((await r.json()) as { code?: string }).code, 'INDISPONIVEL')
      assert.equal(r.headers.get('set-cookie'), null, 'nunca apaga o cookie de sessão')
    }
  })

  it('a janela de falha é curta: depois dela volta a ser 401', () => {
    markSessionCheckFailed(Date.now() - 6_000)
    assert.equal(sessionCheckRecentlyFailed(), false)
    assert.equal(unauthorizedResponse().status, 401)
  })
})
