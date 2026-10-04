import type { Server } from 'socket.io'
import { orgRoom, workspaceRoom } from './events'
import type { ClientToServerEvents, ServerToClientEvents } from './events'

export type PearIo = Server<ClientToServerEvents, ServerToClientEvents>

// O server.ts guarda a instância do Socket.io aqui. Rotas e workers (bundles diferentes do
// processo) enxergam a mesma instância porque `globalThis` é compartilhado.
const holder = globalThis as unknown as { __pearchat_io?: PearIo }

export function setIo(io: PearIo): void {
  holder.__pearchat_io = io
}

// Sem instância (build, testes, execução fora do servidor custom) não faz nada.
export function emitToWorkspace<E extends keyof ServerToClientEvents>(
  workspaceId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  const io = holder.__pearchat_io
  if (!io) return
  const room = io.to(workspaceRoom(workspaceId)) as unknown as {
    emit: (ev: string, ...a: unknown[]) => boolean
  }
  room.emit(event, ...args)
}

/** Aviso leve para todos os espaços da organização (veja SpaceAttentionPayload). */
export function emitToOrganization<E extends keyof ServerToClientEvents>(
  organizationId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  const io = holder.__pearchat_io
  if (!io) return
  const room = io.to(orgRoom(organizationId)) as unknown as { emit: (ev: string, ...a: unknown[]) => boolean }
  room.emit(event, ...args)
}
