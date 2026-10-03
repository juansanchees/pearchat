'use client'

import { useMemo } from 'react'
import { CloudCheck, DownloadSimple, LockSimple, UploadSimple, Warning, WhatsappLogo } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { formatCount } from './format'
import type { ImportResult } from './types'

const ICON = 18

/** Toasts da tela de Contatos (spec 06). */
export function useContactToasts() {
  const { toast } = useAppState()
  return useMemo(
    () => ({
      missingName: () =>
        toast({ icon: <Warning size={ICON} weight="fill" />, title: 'Falta o nome', text: 'Digite o nome do contato' }),
      missingPhone: () =>
        toast({ icon: <Warning size={ICON} weight="fill" />, title: 'Falta o WhatsApp', text: 'Digite o número com DDD' }),
      saved: (name: string) =>
        toast({ icon: <CloudCheck size={ICON} weight="fill" />, title: 'Contato salvo na nuvem', text: name }),
      exported: (total: number) =>
        toast({
          icon: <DownloadSimple size={ICON} weight="fill" />,
          title: 'Exportação pronta',
          text: `${formatCount(total)} contatos em CSV`,
        }),
      imported: (r: ImportResult) => {
        const parts = [`${formatCount(r.criados)} novos`, `${formatCount(r.atualizados)} atualizados`]
        if (r.ignorados > 0) parts.push(`${formatCount(r.ignorados)} ignorados`)
        toast({ icon: <UploadSimple size={ICON} weight="fill" />, title: 'Importar contatos', text: parts.join(' · ') })
      },
      needConnection: () =>
        toast({
          icon: <LockSimple size={ICON} weight="fill" />,
          title: 'Conecte o WhatsApp primeiro',
          text: 'Depois disso você conversa direto daqui',
        }),
      newChat: (name: string) =>
        toast({ icon: <WhatsappLogo size={ICON} weight="fill" />, title: 'Nova conversa', text: `Abrindo conversa com ${name}` }),
      error: (title: string, text: string) =>
        toast({ icon: <Warning size={ICON} weight="fill" />, title, text }),
    }),
    [toast],
  )
}
