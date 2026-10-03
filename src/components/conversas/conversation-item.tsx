'use client'

import { Sparkle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { ContactAvatar } from './contact-avatar'
import { formatListTime } from './format'
import type { ConversationItem as Item } from './types'

export function ConversationItem({
  item,
  active,
  iaOn,
  agentName,
  onSelect,
}: {
  item: Item
  active: boolean
  iaOn: boolean
  agentName: string
  onSelect: (id: string) => void
}) {
  const prefix =
    item.lastMessageAuthor === 'user' ? 'Você: ' : item.lastMessageAuthor === 'ia' ? `${agentName}: ` : ''
  const hasUnread = item.unread > 0

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-3 border-0 border-t border-solid border-light-divider px-3.5 py-3 text-left text-light-text',
        active ? 'bg-light-accent-900' : 'bg-transparent hover:bg-light-neutral-900',
      )}
      style={active ? { boxShadow: 'inset 3px 0 0 #a8c23a' } : undefined}
    >
      <ContactAvatar
        name={item.nome}
        size={42}
        badge={
          item.mode === 'ia' && iaOn ? (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-pill border-2 border-solid border-light-surface bg-light-accent-400">
              <Sparkle size={9} weight="fill" color="#fbfcf3" />
            </span>
          ) : null
        }
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 truncate text-[13.5px] font-medium leading-tight">{item.nome}</span>
          <span className={cn('shrink-0 text-[10.5px]', hasUnread ? 'text-light-accent-300' : 'text-light-neutral-500')}>
            {formatListTime(item.lastMessageAt)}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={cn('flex-1 truncate text-xs', item.typing ? 'text-light-accent-300' : 'text-light-neutral-500')}
          >
            {item.typing ? `${agentName} está digitando…` : `${prefix}${item.lastMessagePreview ?? ''}`}
          </span>
          {hasUnread ? (
            <span className="h-[18px] min-w-[18px] rounded-pill bg-light-accent-400 px-[5px] text-center text-[10.5px] font-medium leading-[18px] text-[#fbfcf3]">
              {item.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
