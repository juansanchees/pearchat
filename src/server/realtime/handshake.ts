// Autorização do handshake do Socket.io: "banco indisponível agora" é diferente de "sessão inválida".
//
// - Resposta DEFINITIVA do banco (usuário inexistente, desativado ou sem espaço liberado, sessionVersion diferente):
//   recusa com SOCKET_UNAUTHORIZED. O cliente não insiste (o fluxo de sessão encerrada age pelas APIs).
// - EXCEÇÃO ao reler (timeout, pool esgotado, "Can't reach database server"): recusa com SOCKET_UNAVAILABLE. A sessão
//   continua válida; o cliente tenta de novo com espera crescente (src/lib/socket-client.ts).
// Mesmo critério de `judgeSession` (src/server/auth/availability.ts, branch do agente de conta/sessão): quando as duas
// ondas forem integradas, este módulo pode passar a chamar aquele (a semântica é a mesma).

export const SOCKET_UNAUTHORIZED = 'unauthorized'
export const SOCKET_UNAVAILABLE = 'unavailable'

export type HandshakeActive = { workspaceId: string; organizationId: string; sessionVersion: number; papel: string; blocked: boolean }

export type HandshakeVerdict<A extends HandshakeActive = HandshakeActive> =
  | { kind: 'ok'; active: A }
  | { kind: typeof SOCKET_UNAUTHORIZED }
  | { kind: typeof SOCKET_UNAVAILABLE; error: unknown }

/**
 * Julga a sessão do socket a partir do que o banco respondeu. Qualquer EXCEÇÃO ao ler é infraestrutura (`unavailable`);
 * só uma resposta do banco pode recusar como `unauthorized`.
 */
export async function judgeHandshake<A extends HandshakeActive>(resolve: () => Promise<A | null>, tokenSessionVersion: number): Promise<HandshakeVerdict<A>> {
  let active: A | null
  try {
    active = await resolve()
  } catch (error) {
    return { kind: SOCKET_UNAVAILABLE, error }
  }
  // Sessão revogada ("sair de todos os dispositivos"), usuário desativado ou sem espaço: resposta definitiva.
  if (!active || active.blocked || tokenSessionVersion !== active.sessionVersion) return { kind: SOCKET_UNAUTHORIZED }
  return { kind: 'ok', active }
}
