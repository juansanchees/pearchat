'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { cn } from '@/lib/utils'
import { ShellCtx } from './shell-context'

// Menu lateral fixo (>= 900 px) ou gaveta com overlay (< 900 px); fecha ao navegar ou com Esc.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

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
          {children}
        </main>
      </div>
    </ShellCtx.Provider>
  )
}
