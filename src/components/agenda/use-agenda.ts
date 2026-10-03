'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CalendarStateDto,
  EventDto,
  EventListResponse,
  FreeSlotsResponse,
  GoogleListStatus,
  ServiceTypeDto,
  ServiceTypeListResponse,
} from '@/server/calendar/types'
import { addDays } from './time'
import { api } from './data'

/** Estado da conexão (GET /api/calendar). */
export function useCalendarState() {
  const [cal, setCal] = useState<CalendarStateDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setCal(await api<CalendarStateDto>('/api/calendar'))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { cal, setCal, loading, error, reload: load }
}

/** Eventos da semana [start, start+7) (datas em São Paulo). */
export function useWeekEvents(start: string | null) {
  const [events, setEvents] = useState<EventDto[]>([])
  const [googleStatus, setGoogleStatus] = useState<GoogleListStatus>('desconectado')
  const [sincronizadoEm, setSincronizadoEm] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!start) return
    const id = ++seq.current
    setLoading(true)
    setError(false)
    try {
      const r = await api<EventListResponse>(`/api/events?from=${start}&to=${addDays(start, 7)}`)
      if (id === seq.current) {
        setEvents(r.eventos)
        setGoogleStatus(r.google?.status ?? 'desconectado')
        setSincronizadoEm(r.google?.sincronizadoEm ?? null)
      }
    } catch {
      if (id === seq.current) setError(true)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [start])

  useEffect(() => {
    void load()
  }, [load])

  return { events, googleStatus, sincronizadoEm, loading, error, reload: load }
}

/** Inícios livres "HH:MM" do dia (GET /api/events/free). */
export function useFreeSlots(date: string | null, duracaoMin: number, ignoreEventId?: string | null) {
  const [horarios, setHorarios] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!date) return
    const id = ++seq.current
    setLoading(true)
    setError(false)
    try {
      const r = await api<FreeSlotsResponse>(`/api/events/free?date=${date}&duracaoMin=${duracaoMin}${ignoreEventId ? `&ignoreEventId=${encodeURIComponent(ignoreEventId)}` : ''}`)
      if (id === seq.current) setHorarios(r.horarios)
    } catch {
      if (id === seq.current) {
        setHorarios([])
        setError(true)
      }
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [date, duracaoMin, ignoreEventId])

  useEffect(() => {
    void load()
  }, [load])

  return { horarios, loading, error, reload: load }
}

/** Tipos de atendimento do negócio (GET /api/service-types). */
export function useServiceTypes() {
  const [tipos, setTipos] = useState<ServiceTypeDto[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setTipos((await api<ServiceTypeListResponse>('/api/service-types')).tipos)
    } catch {
      /* mantém o último valor conhecido */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { tipos, setTipos, loading, reload: load }
}
