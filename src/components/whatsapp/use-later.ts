'use client'
import { useCallback, useEffect, useRef } from 'react'

/** setTimeout que se cancela sozinho ao desmontar (o protótipo vazava timers ao trocar de tela/tipo). */
export function useLater() {
  const ids = useRef<number[]>([])
  useEffect(() => {
    const list = ids.current
    return () => {
      list.forEach((id) => window.clearTimeout(id))
      list.length = 0
    }
  }, [])
  return useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    ids.current.push(id)
  }, [])
}
