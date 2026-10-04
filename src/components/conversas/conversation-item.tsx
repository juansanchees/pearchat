'use client'

import { Camera, FileText, Microphone, Sparkle, Sticker, VideoCamera } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { formatDuration } from '@/server/media/mime'
import { Avatar } from '@/components/pear'
import { cn } from '@/lib/utils'
import { ContactAvatar } from './contact-avatar'
import { formatListTime } from './format'
import type { ConversationItem as Item } from './types'

/** Prévia de mídia na lista: ícone Phosphor + rótulo (Foto, Áudio 0:12, Vídeo, Documento) ou a legenda. */
function mediaPreview(media: NonNullable<Item['lastMessageMedia']>, caption: string): ReactNode {
  const icon = {
    image: <Camera size={13} className="shrink-0" />,
    audio: <Microphone size={13} className="shrink-0" />,
    video: <VideoCamera size={13} className="shrink-0" />,
    document: <FileText size={13} className="shrink-0" />,
    sticker: <Sticker size={13} className="shrink-0" />,
  }[media.type]
  const label = {
    image: 'Foto',
    audio: media.durationSec ? `Áudio ${formatDuration(media.durationSec)}` : 'Áudio',
    video: 'Vídeo',
    document: 'Documento',
    sticker: 'Figurinha',
  }[media.type]
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      {icon}
      <span className="truncate">{caption || label}</span>
    </span>
  )
}

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
      style={active ? { boxShadow: 'inset 3px 0 0 #2e9a48' } : undefined}
    >
      <ContactAvatar
        name={item.nome}
        photoUrl={item.photoUrl}
        size={42}
        badge={
          item.mode === 'ia' && iaOn ? (
            <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-pill border-2 border-solid border-light-surface bg-light-accent-fill">
              <Sparkle size={9} weight="fill" color="#ffffff" />
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
            {item.typing ? (
              `${agentName} está digitando…`
            ) : item.lastMessageMedia ? (
              <span className="flex items-center gap-1">
                {prefix ? <span className="shrink-0">{prefix}</span> : null}
                {mediaPreview(item.lastMessageMedia, item.lastMessagePreview ?? '')}
              </span>
            ) : (
              `${prefix}${item.lastMessagePreview ?? ''}`
            )}
          </span>
          {item.assignee ? <Avatar name={item.assignee.nome} src={item.assignee.fotoUrl} size={18} className="!text-[8px]" /> : null}
          {hasUnread ? (
            <span className="h-[18px] min-w-[18px] rounded-pill bg-light-accent-fill px-[5px] text-center text-[10.5px] font-medium leading-[18px] text-white">
              {item.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
