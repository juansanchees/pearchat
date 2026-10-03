'use client'

import { Check, Checks, Clock, Sparkle, WarningCircle } from '@phosphor-icons/react'
import type { MessageDTO } from '@/lib/types'
import { formatHour } from './format'

export function MessageBubble({ message, agentName }: { message: MessageDTO; agentName: string }) {
  const received = message.author === 'cliente'
  const isIa = message.author === 'ia'

  return (
    <div className={`flex animate-zfIn ${received ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[min(560px,76%)] border border-solid px-[13px] pb-[7px] pt-[9px] ${
          received
            ? 'border-light-divider bg-light-surface'
            : 'border-light-accent-700 bg-light-accent-900'
        } ${message.status === 'pendente' ? 'opacity-70' : ''}`}
        style={{ borderRadius: received ? '14px 14px 14px 4px' : '14px 14px 4px 14px' }}
      >
        {isIa ? (
          <div className="mb-1.5 flex items-center gap-[5px] text-[10.5px] font-medium leading-none text-light-accent-300">
            <Sparkle size={11} weight="fill" />
            {agentName} · IA
          </div>
        ) : null}
        <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.45] [text-wrap:pretty]">
          {message.body}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 text-right text-[10px] text-light-neutral-500">
          {message.status === 'falhou' ? (
            <span className="flex items-center gap-0.5 text-[#b4372a]">
              <WarningCircle size={11} weight="fill" />
              Falha no envio
            </span>
          ) : null}
          {formatHour(message.createdAt)}
          {!received ? <StatusIcon status={message.status} /> : null}
        </div>
      </div>
    </div>
  )
}

// Estado da mensagem enviada: ícone discreto ao lado da hora (atualiza ao vivo via socket `message.status`).
function StatusIcon({ status }: { status: MessageDTO['status'] }) {
  switch (status) {
    case 'pendente':
      return <Clock size={12} aria-label="Enviando" />
    case 'enviada':
      return <Check size={12} aria-label="Enviada" />
    case 'entregue':
      return <Checks size={13} aria-label="Entregue" />
    case 'lida':
      return <Checks size={13} className="text-light-accent-300" aria-label="Lida" />
    default:
      return null
  }
}
