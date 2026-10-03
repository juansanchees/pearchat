'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState } from '@/components/app/app-state'
import { AGENDA_CHANGED, CONTACTS_CHANGED } from '@/components/app/events'
import { useDrawerData } from '@/components/drawers/drawer-data'
import { toCampanha } from '@/components/drawers/view'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import type { SidebarSummary } from '@/app/api/sidebar/route'
import type { CalendarStateDto, EventListResponse } from '@/server/calendar/types'

export type AgendaSummary =
  | { state: 'loading' }
  | { state: 'desconectado' }
  | { state: 'conectado'; hoje: number; proximo: string | null }

const REFRESH_MS = 60_000
const SP_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const hmFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    redirectIfUnauthorized(res.status)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/**
 * Dados reais do menu lateral: cartão Agenda, contador de contatos, fila do follow-up e campanhas.
 * Atualiza ao montar, ao voltar para a aba, a cada minuto e quando as telas avisam
 * (pearchat:agenda-changed / pearchat:contacts-changed). Falhas mantêm o último valor conhecido.
 */
export function useSidebarData() {
  const { setFuQueueCount } = useAppState()
  const { setCampanhas, contatosCount } = useDrawerData()
  const [contatos, setContatos] = useState<number>(contatosCount)
  const [agenda, setAgenda] = useState<AgendaSummary>({ state: 'loading' })
  const seq = useRef({ summary: 0, agenda: 0 })

  const loadSummary = useCallback(async () => {
    const id = ++seq.current.summary
    const s = await getJson<SidebarSummary>('/api/sidebar')
    if (!s || id !== seq.current.summary) return
    setContatos(s.contatos)
    setFuQueueCount(s.fuQueue)
    setCampanhas(s.campanhas.map(toCampanha))
  }, [setFuQueueCount, setCampanhas])

  const loadAgenda = useCallback(async () => {
    const id = ++seq.current.agenda
    const cal = await getJson<CalendarStateDto>('/api/calendar')
    if (id !== seq.current.agenda) return
    if (!cal) {
      setAgenda((cur) => (cur.state === 'loading' ? { state: 'desconectado' } : cur))
      return
    }
    if (!cal.conectado) {
      setAgenda({ state: 'desconectado' })
      return
    }
    const now = Date.now()
    const today = new Date(now - SP_OFFSET_MS).toISOString().slice(0, 10)
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
    const ev = await getJson<EventListResponse>(`/api/events?from=${today}&to=${tomorrow}`)
    if (id !== seq.current.agenda) return
    if (!ev) {
      setAgenda((cur) => (cur.state === 'loading' ? { state: 'conectado', hoje: 0, proximo: null } : cur))
      return
    }
    const startOfDay = Date.parse(`${today}T00:00:00-03:00`)
    const hoje = ev.eventos.filter((e) => Date.parse(e.inicio) >= startOfDay)
    const next = hoje.find((e) => Date.parse(e.inicio) >= now)
    setAgenda({ state: 'conectado', hoje: hoje.length, proximo: next ? hmFmt.format(new Date(next.inicio)) : null })
  }, [])

  useEffect(() => {
    void loadSummary()
    void loadAgenda()
    const refresh = () => {
      void loadSummary()
      void loadAgenda()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onAgenda = () => void loadAgenda()
    const onContacts = () => void loadSummary()
    const timer = window.setInterval(onVisible, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(AGENDA_CHANGED, onAgenda)
    window.addEventListener(CONTACTS_CHANGED, onContacts)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(AGENDA_CHANGED, onAgenda)
      window.removeEventListener(CONTACTS_CHANGED, onContacts)
    }
  }, [loadSummary, loadAgenda])

  return { contatos, agenda }
}
