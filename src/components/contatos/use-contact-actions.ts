'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppState } from '@/components/app/app-state'
import { api } from './api'
import type { Contact } from './types'
import { useContactToasts } from './toasts'

/** "Conversar" e "Agendar" do painel do contato. */
export function useContactActions(patchLocal: (id: string, patch: Partial<Contact>) => void) {
  const router = useRouter()
  const { connected } = useAppState()
  const toasts = useContactToasts()
  const [opening, setOpening] = useState(false)

  const chat = useCallback(
    async (contact: Contact) => {
      if (!connected) {
        toasts.needConnection()
        return
      }
      if (contact.conversationId) {
        router.push(`/whatsapp?c=${encodeURIComponent(contact.conversationId)}`)
        return
      }
      setOpening(true)
      try {
        const { conversationId } = await api<{ conversationId: string }>(`/api/contacts/${contact.id}/conversation`, {
          method: 'POST',
        })
        patchLocal(contact.id, { conversationId })
        toasts.newChat(contact.name)
        router.push(`/whatsapp?c=${encodeURIComponent(conversationId)}`)
      } catch (e) {
        toasts.error('Não foi possível abrir a conversa', e instanceof Error ? e.message : 'Tente novamente')
      } finally {
        setOpening(false)
      }
    },
    [connected, router, toasts, patchLocal],
  )

  const schedule = useCallback(
    (contact: Contact) => router.push(`/agenda?cliente=${encodeURIComponent(contact.name)}`),
    [router],
  )

  return { chat, schedule, opening }
}
