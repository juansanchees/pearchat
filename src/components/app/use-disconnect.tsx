'use client'

import { useCallback } from 'react'
import { Plugs } from '@phosphor-icons/react'
import { useAppState } from './app-state'

// Desconecta o WhatsApp (rota do agente B), desliga IA e Follow-up e avisa.
export function useDisconnect() {
  const { setWa, closeDrawer, toast } = useAppState()
  return useCallback(async () => {
    try {
      await fetch('/api/wa/disconnect', { method: 'POST' })
    } catch {
      // segue: a UI reflete o estado desconectado mesmo se a rota falhar
    }
    setWa({ provider: null, status: 'desconectado', numero: null })
    closeDrawer()
    await Promise.allSettled(
      (['ia', 'followup', 'disparos'] as const).map((key) =>
        fetch('/api/automations', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, on: false }),
        }),
      ),
    )
    toast({ icon: <Plugs size={18} weight="fill" />, title: 'WhatsApp desconectado', text: 'As automações foram desligadas' })
  }, [setWa, closeDrawer, toast])
}
