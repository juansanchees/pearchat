'use client'

import { CaretLeft, Clock, Hand, Sparkle, User } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { ConversationModeKind } from '@/lib/types'
import { AssigneePicker } from './assignee-picker'
import { ContactAvatar } from './contact-avatar'
import { formatPhone } from './format'
import type { ConversationItem } from './types'

export function ChatHeader({
  conversation,
  iaOn,
  followupOn = false,
  agentName,
  onMode,
  onBack,
  aiReply,
}: {
  conversation: ConversationItem
  iaOn: boolean
  /** Follow-up ligado: também permite devolver a conversa para a automação. */
  followupOn?: boolean
  agentName: string
  onMode: (mode: ConversationModeKind) => void
  /** Volta para a lista (só aparece abaixo de 900 px). */
  onBack?: () => void
  /** Conversa esperando resposta: ação "Responder com a IA" (some quando não há o que responder). */
  aiReply?: { pendente: boolean; respondendo: boolean; onClick: () => void }
}) {
  const isIaMode = iaOn && conversation.mode === 'ia'

  let pill: { text: string; icon: ReactNode; className: string }
  if (isIaMode) {
    pill = {
      text: `${agentName} (IA) respondendo`,
      icon: <Sparkle size={13} />,
      className: 'border-light-accent-700 bg-light-accent-900 text-light-accent-200',
    }
  } else if (conversation.mode === 'humano') {
    pill = {
      text: 'Você está atendendo',
      icon: <User size={13} />,
      className: 'border-light-divider bg-light-bg text-light-neutral-400',
    }
  } else if (conversation.unread > 0) {
    pill = {
      text: 'Aguardando resposta',
      icon: <Clock size={13} />,
      className: 'border-light-divider bg-light-bg text-light-neutral-400',
    }
  } else {
    pill = {
      text: 'Conversa aberta',
      icon: <Clock size={13} />,
      className: 'border-light-divider bg-light-bg text-light-neutral-400',
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-light-divider bg-light-surface px-5 py-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar para as conversas"
          className="grid h-8 w-8 flex-none place-items-center rounded-md border border-solid border-light-divider bg-light-surface p-0 text-light-text hover:bg-[rgba(29,33,23,.07)] min-[900px]:hidden"
        >
          <CaretLeft size={16} aria-hidden="true" />
        </button>
      ) : null}
      <ContactAvatar name={conversation.nome} size={40} photoUrl={conversation.photoUrl} />
      <div className="min-w-[160px] flex-1">
        <div className="text-[14.5px] font-medium leading-tight">{conversation.nome}</div>
        <div className="mt-0.5 text-[11.5px] text-light-neutral-500">{formatPhone(conversation.telefone)}</div>
      </div>
      <span
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-solid px-2.5 py-[5px] text-[11.5px] ${pill.className}`}
      >
        {pill.icon}
        {pill.text}
      </span>
      <AssigneePicker conversation={conversation} />
      {aiReply && (aiReply.pendente || aiReply.respondendo) ? (
        <button
          type="button"
          onClick={aiReply.onClick}
          disabled={aiReply.respondendo}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-solid border-light-accent-500 px-[13px] py-1.5 text-xs font-medium leading-tight text-light-accent-300 hover:bg-[rgba(46,154,72,.12)] active:bg-[rgba(46,154,72,.22)] disabled:cursor-default disabled:opacity-70"
        >
          <Sparkle size={14} weight={aiReply.respondendo ? 'fill' : 'regular'} className={aiReply.respondendo ? 'animate-pulse' : undefined} />
          {aiReply.respondendo ? `${agentName} respondendo…` : 'Responder com a IA'}
        </button>
      ) : null}
      {isIaMode ? (
        <button
          type="button"
          onClick={() => onMode('humano')}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-solid border-light-accent-500 px-[13px] py-1.5 text-xs font-medium leading-tight text-light-accent-300 hover:bg-[rgba(46,154,72,.12)] active:bg-[rgba(46,154,72,.22)]"
        >
          <Hand size={14} />
          Assumir conversa
        </button>
      ) : null}
      {(iaOn || followupOn) && conversation.mode === 'humano' ? (
        <button
          type="button"
          onClick={() => onMode('ia')}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-solid border-light-divider px-[13px] py-1.5 text-xs font-medium leading-tight text-light-text hover:bg-[rgba(29,33,23,.07)] active:bg-[rgba(29,33,23,.14)]"
        >
          <Sparkle size={14} />
          {iaOn ? 'Devolver para IA' : 'Devolver para automação'}
        </button>
      ) : null}
    </div>
  )
}
