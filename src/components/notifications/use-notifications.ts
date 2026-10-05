'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAppState } from '@/components/app/app-state'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { useRawSocketEvent } from '@/lib/socket-client'
import type { NotificationDTO, SyncResponse, Tela } from '@/server/notifications/types'

const SYNC_MS = 60_000
const HEARTBEAT_MS = 60_000
/** Duas sincronizações não saem mais juntas que isso (foco + visibilidade chegam quase ao mesmo tempo). */
const MIN_GAP_MS = 4_000
/** Eventos de tempo real são agrupados: no máximo uma sincronização a cada tantos segundos (o servidor ainda espera o que está em andamento). */
const TEMPO_REAL_MS = 10_000

export function telaDe(pathname: string): Tela {
  if (pathname.startsWith('/whatsapp')) return 'conversas'
  if (pathname.startsWith('/agenda')) return 'agenda'
  if (pathname.startsWith('/contatos')) return 'contatos'
  return 'outra'
}

/** A aba está visível e em foco: é isso que conta como "a pessoa está olhando". */
const presente = () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()

export type Ausente = { resumo: string; desde: string }

/**
 * Estado do sininho: sincroniza ao carregar, ao voltar o foco/visibilidade, a cada 60 s com a aba visível e (agrupando
 * rajadas) quando chegam eventos de tempo real do socket. Manda um batimento a cada 60 s só com a aba visível e em foco.
 * Tudo é do espaço ativo da sessão: o cliente nunca manda usuário nem espaço.
 */
export function useNotifications(onAusente: (a: Ausente) => void) {
  const { workspaceId, toast } = useAppState()
  const pathname = usePathname()
  const [itens, setItens] = useState<NotificationDTO[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [carregado, setCarregado] = useState(false)
  const [falhou, setFalhou] = useState(false)
  const itensRef = useRef(itens)
  itensRef.current = itens

  const telaRef = useRef<Tela>(telaDe(pathname))
  telaRef.current = telaDe(pathname)
  const onAusenteRef = useRef(onAusente)
  onAusenteRef.current = onAusente
  const toastRef = useRef(toast)
  toastRef.current = toast

  const emVoo = useRef(false)
  const ultima = useRef(0)
  const pausadoAte = useRef(0)
  /** Sobe a cada mudança local (ler/apagar): uma resposta que saiu ANTES dela é descartada para não "desfazer" a tela. */
  const epoca = useRef(0)
  const timerTempoReal = useRef<number | undefined>(undefined)

  const sync = useCallback(async (force = false): Promise<void> => {
    const agora = Date.now()
    if (emVoo.current || agora < pausadoAte.current) return
    if (!force && agora - ultima.current < MIN_GAP_MS) return
    emVoo.current = true
    ultima.current = agora
    const epocaInicial = epoca.current
    try {
      const res = await fetch('/api/notifications/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visivel: presente(), tela: telaRef.current }),
        cache: 'no-store',
      })
      redirectIfUnauthorized(res.status)
      if (res.status === 429) {
        pausadoAte.current = Date.now() + (Number(res.headers.get('Retry-After')) || 30) * 1000
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as SyncResponse
      setFalhou(false)
      if (epoca.current === epocaInicial) {
        setItens(data.itens)
        setNaoLidas(data.naoLidas)
      }
      if (data.resumoAusente && data.ausenteDesde) onAusenteRef.current({ resumo: data.resumoAusente, desde: data.ausenteDesde })
    } catch {
      setFalhou(true)
    } finally {
      emVoo.current = false
      setCarregado(true)
    }
  }, [])

  // Carga inicial, volta de foco/visibilidade, intervalo e batimento.
  useEffect(() => {
    void sync(true)
    let t0: number | undefined
    const aoVoltar = () => {
      window.clearTimeout(t0)
      t0 = window.setTimeout(() => void sync(false), 300)
    }
    const aoVisivel = () => {
      if (document.visibilityState === 'visible') aoVoltar()
    }
    document.addEventListener('visibilitychange', aoVisivel)
    window.addEventListener('focus', aoVoltar)
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync(true)
    }, SYNC_MS)
    // Batimento defasado em meio minuto da sincronização, só com a aba visível e em foco.
    let batimento: number | undefined
    const primeiro = window.setTimeout(() => {
      const bater = () => {
        if (presente()) void fetch('/api/notifications/heartbeat', { method: 'POST', cache: 'no-store' }).catch(() => undefined)
      }
      bater()
      batimento = window.setInterval(bater, HEARTBEAT_MS)
    }, HEARTBEAT_MS / 2)
    return () => {
      window.clearTimeout(t0)
      window.clearTimeout(primeiro)
      window.clearInterval(intervalo)
      window.clearInterval(batimento)
      window.clearTimeout(timerTempoReal.current)
      document.removeEventListener('visibilitychange', aoVisivel)
      window.removeEventListener('focus', aoVoltar)
    }
  }, [sync, workspaceId])

  // Tempo real: eventos que já existem no socket só "cutucam"; quem calcula é o servidor. No máximo 1 cutucada a cada 10 s.
  const cutucar = useCallback(() => {
    if (document.visibilityState !== 'visible' || timerTempoReal.current !== undefined) return
    timerTempoReal.current = window.setTimeout(() => {
      timerTempoReal.current = undefined
      void sync(false)
    }, TEMPO_REAL_MS)
  }, [sync])
  useRawSocketEvent('message.received', cutucar)
  useRawSocketEvent('conversation.updated', cutucar)
  useRawSocketEvent('handoff.requested', cutucar)
  useRawSocketEvent('agenda.updated', cutucar)
  useRawSocketEvent('connection.update', cutucar)

  const falha = useCallback((titulo: string) => toastRef.current({ title: titulo, text: 'Tente novamente em instantes.' }), [])

  /** Marca como lidas (as ids ou todas). Atualiza a tela na hora e confirma com o servidor. */
  const marcarLidas = useCallback(
    async (ids?: string[]): Promise<void> => {
      epoca.current++
      const jaLidas = new Set(itensRef.current.filter((i) => i.lida).map((i) => i.id))
      const novas = ids ? ids.filter((id) => !jaLidas.has(id)).length : 0
      setItens((cur) => cur.map((i) => (i.lida || (ids && !ids.includes(i.id)) ? i : { ...i, lida: true })))
      setNaoLidas((n) => (ids ? Math.max(0, n - novas) : 0))
      try {
        const res = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ids ? { ids } : {}),
        })
        redirectIfUnauthorized(res.status)
        if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      } catch {
        falha('Não foi possível marcar como lida')
      } finally {
        void sync(true)
      }
    },
    [falha, sync],
  )

  const apagar = useCallback(
    async (id: string): Promise<void> => {
      epoca.current++
      setItens((cur) => cur.filter((i) => i.id !== id))
      setNaoLidas((n) => {
        const antes = itensRef.current.find((i) => i.id === id)
        return antes && !antes.lida ? Math.max(0, n - 1) : n
      })
      try {
        const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' })
        redirectIfUnauthorized(res.status)
        if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      } catch {
        falha('Não foi possível apagar')
      } finally {
        void sync(true)
      }
    },
    [falha, sync],
  )

  const limpar = useCallback(async (): Promise<void> => {
    epoca.current++
    setItens([])
    setNaoLidas(0)
    try {
      const res = await fetch('/api/notifications', { method: 'DELETE' })
      redirectIfUnauthorized(res.status)
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      falha('Não foi possível limpar o histórico')
    } finally {
      void sync(true)
    }
  }, [falha, sync])

  return { itens, naoLidas, carregado, falhou, sync, marcarLidas, apagar, limpar }
}
