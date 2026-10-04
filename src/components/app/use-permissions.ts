'use client'

import { useAppState } from '@/components/app/app-state'
import { normalizePapel, papelCan } from '@/server/auth/permissions'
import type { Action, Papel } from '@/server/auth/permissions'

/**
 * Papel e permissões da pessoa logada, para a interface acompanhar (esconder/desabilitar). A barreira de verdade é o
 * servidor: toda rota confere papel e espaço, então esconder um botão aqui nunca é a única proteção.
 */
export function usePermissions(): { papel: Papel; can: (action: Action) => boolean; isOwner: boolean; isManager: boolean; isAgent: boolean } {
  const { user } = useAppState()
  const papel = normalizePapel(user.papel)
  return {
    papel,
    can: (action) => papelCan(papel, action),
    isOwner: papel === 'owner',
    isManager: papel !== 'agent',
    isAgent: papel === 'agent',
  }
}
