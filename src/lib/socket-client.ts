'use client'

import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@/server/realtime/events'

export type PearSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: PearSocket | null = null

// Recusas do handshake (mesmos textos de src/server/realtime/handshake.ts; o cliente não importa código do servidor).
const REFUSED_UNAUTHORIZED = 'unauthorized' // sessão inválida: não insiste
/** Espera entre tentativas manuais depois de uma recusa temporária ("unavailable"): 2, 5, 10, 30 e 60 s, com variação. */
const MANUAL_RETRY_MS = [2_000, 5_000, 10_000, 30_000, 60_000]
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryAttempt = 0
/** Houve recusa/erro desde a última conexão: ao conectar de novo, a tela ressincroniza o que perdeu. */
let missedSinceError = false

function scheduleManualReconnect(s: PearSocket): void {
  if (retryTimer !== undefined) return
  const base = MANUAL_RETRY_MS[Math.min(retryAttempt, MANUAL_RETRY_MS.length - 1)]!
  const delay = Math.round(base * (0.8 + Math.random() * 0.4)) // ±20%: abas não voltam todas juntas
  retryAttempt++
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (socket === s && !s.connected) s.connect()
  }, delay)
}

// Singleton: uma conexão por aba. A autenticação é o cookie de sessão (mesma origem).
// Só é criado quando algum componente do app (que exige sessão) pede. Queda de rede: o socket.io reconecta sozinho.
// Recusa do servidor no handshake: o socket.io NÃO reconecta sozinho; "unavailable" (banco fora agora) tenta de novo
// com espera crescente; "unauthorized" não insiste (o fluxo de sessão encerrada age pelas APIs).
export function getSocket(): PearSocket {
  if (!socket) {
    const s: PearSocket = io({
      path: '/api/socket',
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
    s.on('connect_error', (err) => {
      missedSinceError = true
      if (s.active) return // erro de rede/transporte: o próprio socket.io tenta de novo
      if (err.message === REFUSED_UNAUTHORIZED) return
      scheduleManualReconnect(s)
    })
    s.on('connect', () => {
      retryAttempt = 0
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      retryTimer = undefined
      if (missedSinceError) {
        missedSinceError = false
        // Eventos podem ter se perdido enquanto o tempo real estava fora: a mesma atualização da volta de foco da aba.
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') document.dispatchEvent(new Event('visibilitychange'))
      }
    })
    socket = s
  }
  return socket
}

/** Encerra a conexão (ao sair do app). A próxima chamada a getSocket abre outra. */
export function closeSocket(): void {
  if (!socket) return
  if (retryTimer !== undefined) clearTimeout(retryTimer)
  retryTimer = undefined
  retryAttempt = 0
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
