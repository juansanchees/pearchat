// Handshake do Socket.io: banco indisponível (exceção) recusa como "unavailable" (o cliente tenta de novo); só resposta
// definitiva do banco recusa como "unauthorized". Puro, sem banco. Rodar: npx tsx --test tests/realtime/handshake.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { judgeHandshake, SOCKET_UNAUTHORIZED, SOCKET_UNAVAILABLE } from '../../src/server/realtime/handshake'

const active = (o: Partial<{ sessionVersion: number; blocked: boolean }> = {}) => ({
  workspaceId: 'ws_teste',
  organizationId: 'org_teste',
  sessionVersion: o.sessionVersion ?? 3,
  papel: 'owner',
  blocked: o.blocked ?? false,
})

describe('critério do handshake do socket', () => {
  it('exceção ao reler (pool esgotado, banco fora): unavailable, nunca unauthorized', async () => {
    for (const err of [new Error('Timed out fetching a new connection from the connection pool'), new Error("Can't reach database server"), 'falha qualquer']) {
      const v = await judgeHandshake(async () => {
        throw err
      }, 3)
      assert.equal(v.kind, SOCKET_UNAVAILABLE)
    }
  })

  it('usuário desativado (ou atendente sem espaço liberado): unauthorized', async () => {
    assert.equal((await judgeHandshake(async () => active({ blocked: true }), 3)).kind, SOCKET_UNAUTHORIZED)
  })

  it('usuário inexistente e sessão revogada (sessionVersion diferente): unauthorized', async () => {
    assert.equal((await judgeHandshake(async () => null, 3)).kind, SOCKET_UNAUTHORIZED)
    assert.equal((await judgeHandshake(async () => active({ sessionVersion: 4 }), 3)).kind, SOCKET_UNAUTHORIZED)
  })

  it('sessão válida: ok com o espaço ativo', async () => {
    const v = await judgeHandshake(async () => active(), 3)
    assert.equal(v.kind, 'ok')
    if (v.kind === 'ok') assert.equal(v.active.workspaceId, 'ws_teste')
  })
})
