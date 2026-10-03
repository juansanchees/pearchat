import type { Server } from 'socket.io'
import { workspaceRoom } from './events'
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
