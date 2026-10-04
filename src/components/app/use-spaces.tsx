'use client'

import { useCallback, useState } from 'react'
import { Warning } from '@phosphor-icons/react'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { useAppState } from './app-state'

async function readError(res: Response): Promise<{ message: string; code?: string }> {
  const data: unknown = await res.json().catch(() => null)
  const o = data && typeof data === 'object' ? (data as { error?: unknown; code?: unknown }) : {}
  return { message: typeof o.error === 'string' ? o.error : 'Tente novamente em instantes.', code: typeof o.code === 'string' ? o.code : undefined }
}

/**
 * Ações de espaços (WhatsApps). Trocar de espaço RECARREGA a página inteira em /whatsapp: é a forma mais segura de
 * garantir que nenhum estado em memória (listas, rascunhos, gavetas, socket) do espaço anterior sobreviva.
 */
export function useSpaceActions() {
  const { toast, openDrawer, closeDrawer, workspaceId } = useAppState()
  const [busy, setBusy] = useState(false)

  const fail = useCallback(
    (title: string, text: string) => toast({ icon: <Warning size={18} weight="fill" />, title, text }),
    [toast],
  )

  // Sem a trava `busy`: quem chama já controla o estado (evita ler um `busy` antigo capturado no fechamento).
  const doSwitch = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch('/api/spaces/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: id }),
        })
        redirectIfUnauthorized(res.status)
        if (!res.ok) {
          fail('Não foi possível trocar de WhatsApp', (await readError(res)).message)
          return false
        }
        window.location.assign('/whatsapp')
        return true
      } catch {
        fail('Não foi possível trocar de WhatsApp', 'Verifique sua conexão e tente novamente.')
        return false
      }
    },
    [fail],
  )

  const switchTo = useCallback(
    async (id: string): Promise<boolean> => {
      if (busy) return false
      if (id === workspaceId) return true
      setBusy(true)
      const ok = await doSwitch(id)
      if (!ok) setBusy(false)
      return ok
    },
    [busy, workspaceId, doSwitch],
  )

  /** Cria o espaço e já leva para ele (tela "Conecte seu WhatsApp"). */
  const create = useCallback(
    async (nome: string): Promise<boolean> => {
      if (busy) return false
      setBusy(true)
      try {
        const res = await fetch('/api/spaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome }),
        })
        redirectIfUnauthorized(res.status)
        if (!res.ok) {
          const err = await readError(res)
          if (err.code === 'LIMITE_PLANO') {
            fail(err.message, 'Mude de plano para adicionar mais números.')
            openDrawer('plano')
          } else {
            fail('Não foi possível adicionar', err.message)
          }
          setBusy(false)
          return false
        }
        const created = (await res.json()) as { id: string }
        const ok = await doSwitch(created.id)
        if (!ok) setBusy(false)
        return ok
      } catch {
        fail('Não foi possível adicionar', 'Verifique sua conexão e tente novamente.')
        setBusy(false)
        return false
      }
    },
    [busy, fail, openDrawer, doSwitch],
  )

  /** Chamado ao tocar em "+ Adicionar WhatsApp" com o limite do plano já atingido. */
  const limitReached = useCallback(
    (limite: number) => {
      closeDrawer()
      fail(`Seu plano permite ${limite} ${limite === 1 ? 'WhatsApp' : 'WhatsApps'}`, 'Mude de plano para adicionar mais números.')
      openDrawer('plano')
    },
    [closeDrawer, fail, openDrawer],
  )

  return { switchTo, create, limitReached, busy }
}
