'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { useRawSocketEvent } from '@/lib/socket-client'
import { cn } from '@/lib/utils'
import { BillingBanner } from './billing-banner'
import { ShellCtx } from './shell-context'

// Menu lateral fixo (>= 900 px) ou gaveta com overlay (< 900 px); fecha ao navegar ou com Esc.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [offline, setOffline] = useState(false)
  const offlineTimer = useRef<number | undefined>(undefined)

  // Socket caído por mais de 5 s (servidor fora ou sem internet) mostra a faixa; ao reconectar ela some.
  const markDown = () => {
    if (offlineTimer.current === undefined) offlineTimer.current = window.setTimeout(() => setOffline(true), 5000)
  }
  useRawSocketEvent('disconnect', markDown)
  useRawSocketEvent('connect_error', markDown)
  useRawSocketEvent('connect', () => {
    window.clearTimeout(offlineTimer.current)
    offlineTimer.current = undefined
    setOffline(false)
  })
  useEffect(() => () => window.clearTimeout(offlineTimer.current), [])

  useEffect(() => setMenuOpen(false), [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const value = useMemo(() => ({ menuOpen, setMenuOpen }), [menuOpen])

  return (
    <ShellCtx.Provider value={value}>
      <div className="flex h-screen overflow-hidden bg-dark-bg text-[13.5px] text-dark-text">
        <div
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
          className={cn(
            'fixed inset-0 z-30 bg-black/60 transition-opacity duration-200 min-[900px]:hidden',
            menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-light-bg text-light-text [color-scheme:light]">
          {offline ? (
            <div
              role="status"
              className="shrink-0 border-0 border-b border-solid border-amber-border bg-amber-bg px-4 py-1.5 text-center text-[12px] leading-tight text-amber-text"
            >
              Sem conexão. Tentando reconectar…
            </div>
          ) : null}
          <BillingBanner />
          {children}
        </main>
      </div>
    </ShellCtx.Provider>
  )
}
