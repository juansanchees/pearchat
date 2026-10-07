'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState } from '@/components/app/app-state'
import { AGENDA_CHANGED, CONTACTS_CHANGED } from '@/components/app/events'
import { useDrawerData } from '@/components/drawers/drawer-data'
import { toCampanha } from '@/components/drawers/view'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { addDaysYmd, hmOf, ymdOf, zonedToInstant } from '@/lib/timezone'
import type { SidebarSummary } from '@/app/api/sidebar/route'
import type { CalendarStateDto, EventListResponse } from '@/server/calendar/types'

export type AgendaSummary =
  | { state: 'loading' }
  | { state: 'desconectado' }
  | { state: 'conectado'; hoje: number; proximo: string | null }

const REFRESH_MS = 60_000

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
  const { setFuQueueCount, locale } = useAppState()
  // "Hoje" e a hora do próximo compromisso no relógio do espaço.
  const tz = locale.timezone
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
    setCampanhas(s.campanhas.map((c) => toCampanha(c, tz)))
  }, [setFuQueueCount, setCampanhas, tz])

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
    const today = ymdOf(new Date(now), tz)
    const tomorrow = addDaysYmd(today, 1)
    const ev = await getJson<EventListResponse>(`/api/events?from=${today}&to=${tomorrow}`)
    if (id !== seq.current.agenda) return
    if (!ev) {
      setAgenda((cur) => (cur.state === 'loading' ? { state: 'conectado', hoje: 0, proximo: null } : cur))
      return
    }
    const startOfDay = zonedToInstant(today, '00:00', tz).getTime()
    const hoje = ev.eventos.filter((e) => Date.parse(e.inicio) >= startOfDay)
    const next = hoje.find((e) => Date.parse(e.inicio) >= now)
    setAgenda({ state: 'conectado', hoje: hoje.length, proximo: next ? hmOf(new Date(next.inicio), tz) : null })
  }, [tz])

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
