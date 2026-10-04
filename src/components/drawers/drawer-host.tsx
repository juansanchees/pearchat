'use client'

import { useEffect } from 'react'
import { useAppState } from '@/components/app/app-state'
import { ConfigDrawer } from './config-drawer'
import { DisparosDrawer } from './disparos-drawer'
import { FollowupDrawer } from './followup-drawer'
import { IaDrawer } from './ia-drawer'
import { PlanoDrawer } from './plano-drawer'
import { ResultadosDrawer } from './resultados-drawer'

export function DrawerHost() {
  const { drawer, closeDrawer } = useAppState()

  // Esc fecha o drawer em qualquer momento.
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, closeDrawer])

  switch (drawer) {
    case 'ia':
      return <IaDrawer />
    case 'disparos':
      return <DisparosDrawer />
    case 'followup':
      return <FollowupDrawer />
    case 'config':
      return <ConfigDrawer />
    case 'plano':
      return <PlanoDrawer />
    case 'resultados':
      return <ResultadosDrawer />
    default:
      return null
  }
}
