'use client'

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'

type HistoryState = {
  supported: boolean
  status: 'nao_iniciada' | 'importando' | 'concluida' | 'erro'
  importedAt: string | null
  sincronizando: boolean
}

const POLL_MS = 4_000

/**
 * Importação das conversas anteriores do WhatsApp (só conexão rápida). Acompanha o andamento por polling
 * e chama `onDone` para recarregar a lista quando uma importação termina ou traz novidades.
 */
export function useHistoryImport(onDone: () => void) {
  const { wa, toast } = useAppState()
  const eligible = wa.provider === 'rapida' && wa.status === 'conectado'
  const [state, setState] = useState<HistoryState | null>(null)
  const [starting, setStarting] = useState(false)
  const lastRef = useRef<{ status: string; importedAt: string | null } | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/wa/history', { cache: 'no-store' })
      if (!res.ok) return
      const next = (await res.json()) as HistoryState
      const prev = lastRef.current
      lastRef.current = { status: next.status, importedAt: next.importedAt }
      setState(next)
      if (prev && next.status !== 'importando' && (prev.status === 'importando' || prev.importedAt !== next.importedAt)) {
        onDoneRef.current()
      }
    } catch {
      // sem rede: tenta de novo no próximo ciclo
    }
  }, [])

  useEffect(() => {
    if (!eligible) return
    void refresh()
  }, [eligible, refresh])

  const active = eligible && !!state && (state.status === 'importando' || state.sincronizando)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [active, refresh])

  const start = useCallback(async () => {
    setStarting(true)
    try {
      const res = await fetch('/api/wa/history/import', { method: 'POST', cache: 'no-store' })
      if (res.ok || res.status === 409) {
        toast({
          icon: createElement(CheckCircle, { size: 18, weight: 'fill' }),
          title: 'Importando suas conversas',
          text: 'Isso leva alguns instantes. Grupos não são importados.',
        })
      } else {
        toast({
          icon: createElement(WarningCircle, { size: 18, weight: 'fill' }),
          title: 'Não foi possível importar',
          text: 'Tente novamente em instantes.',
        })
      }
      await refresh()
    } finally {
      setStarting(false)
    }
  }, [refresh, toast])

  const importing = eligible && !!state && (state.status === 'importando' || starting)
  return {
    /** Mostra o botão "Importar conversas anteriores" (conexão rápida conectada). */
    canImport: eligible && !!state?.supported,
    importing,
    /** Primeiros 30 min depois de conectar: o histórico chega aos poucos. */
    syncing: eligible && !!state?.sincronizando,
    failed: eligible && state?.status === 'erro',
    start,
  }
}
