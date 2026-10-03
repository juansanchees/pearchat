'use client'

import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@/server/realtime/events'

export type PearSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: PearSocket | null = null

// Singleton: uma conexão por aba. A autenticação é o cookie de sessão (mesma origem).
// Só é criado quando algum componente do app (que exige sessão) pede; reconecta sozinho.
export function getSocket(): PearSocket {
  if (!socket) {
    socket = io({
      path: '/api/socket',
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
  }
  return socket
}

/** Encerra a conexão (ao sair do app). A próxima chamada a getSocket abre outra. */
export function closeSocket(): void {
  if (!socket) return
  socket.removeAllListeners()
  socket.close()
  socket = null
}

type RawSocket = {
  on: (ev: string, fn: (...a: unknown[]) => void) => void
  off: (ev: string, fn: (...a: unknown[]) => void) => void
}

// Assina um evento enquanto o componente está montado. O handler pode mudar a cada render.
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  useRawSocketEvent(event, handler as unknown as (payload: never) => void)
}

/**
 * Igual a useSocketEvent, mas para eventos ainda fora de ServerToClientEvents
 * (ex.: 'handoff.requested', 'connect'). O payload é tipado por quem chama.
 */
export function useRawSocketEvent<P>(event: string, handler: (payload: P) => void): void {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    const s = getSocket() as unknown as RawSocket
    const listener = (...args: unknown[]) => (ref.current as (...a: unknown[]) => void)(...args)
    s.on(event, listener)
    return () => s.off(event, listener)
  }, [event])
}
