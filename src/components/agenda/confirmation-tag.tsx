'use client'

import { Tag } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { EventDto } from '@/server/calendar/types'

/**
 * Etiqueta do estado da confirmação de presença: "Confirmado" (verde), "Aguardando confirmação" (neutra, só depois de o
 * lembrete que pede confirmação ter saído) e "Pediu para remarcar" (âmbar). Não aparece em compromissos do Google.
 */
export function ConfirmacaoTag({ ev, compact }: { ev: EventDto; compact?: boolean }) {
  if (ev.somenteLeitura || ev.origem === 'GOOGLE') return null
  const cls = compact ? '!flex-none !rounded-[4px] !px-[5px] !py-px !text-[9px]' : '!px-[7px] !py-px !text-[10px]'
  if (ev.confirmacao === 'confirmado') {
    return (
      <Tag tone="accent" className={cls}>
        Confirmado
      </Tag>
    )
  }
  if (ev.confirmacao === 'recusado') {
    return (
      <Tag tone="neutral" className={cn(cls, '!bg-amber-bg !text-amber-text')}>
        Pediu para remarcar
      </Tag>
    )
  }
  if (ev.lembreteEnviado) {
    return (
      <Tag tone="neutral" className={cls}>
        Aguardando confirmação
      </Tag>
    )
  }
  return null
}
