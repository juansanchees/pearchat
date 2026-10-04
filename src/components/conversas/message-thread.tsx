'use client'

import { ArrowClockwise, Sparkle, Warning } from '@phosphor-icons/react'
import { Fragment, useLayoutEffect, useRef } from 'react'
import { Spinner } from '@/components/pear'
import type { MessageDTO } from '@/lib/types'
import { dayKey, formatDayLabel } from './format'
import { MessageBubble } from './message-bubble'

const NEAR_BOTTOM_PX = 80

export function MessageThread({
  conversationId,
  messages,
  loading,
  error,
  onRetry,
  hasMore,
  loadingOlder,
  onLoadOlder,
  typing,
  agentName,
  onRetryMedia,
}: {
  conversationId: string
  messages: MessageDTO[]
  loading: boolean
  error: boolean
  onRetry: () => void
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  typing: boolean
  agentName: string
  onRetryMedia: (messageId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastConv = useRef(conversationId)
  const prevHeight = useRef<number | null>(null)
  const firstId = useRef<string | undefined>(undefined)

  function onScroll() {
    const el = ref.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (lastConv.current !== conversationId) {
      lastConv.current = conversationId
      stick.current = true
      prevHeight.current = null
    }
    const newFirst = messages[0]?.id
    // Histórico prependado: mantém a posição de leitura em vez de pular para o fim.
    if (prevHeight.current !== null && firstId.current !== newFirst) {
      el.scrollTop += el.scrollHeight - prevHeight.current
      prevHeight.current = null
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight
    }
    firstId.current = newFirst
  }, [conversationId, messages, typing])

  // Mensagem enviada pelo próprio usuário sempre leva ao fim.
  const last = messages[messages.length - 1]
  const lastIsMine = last?.author === 'user'
  useLayoutEffect(() => {
    if (lastIsMine && ref.current) {
      stick.current = true
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [last?.id, lastIsMine])

  // Mídia que termina de carregar aumenta a altura da conversa: quem estava no fim continua no fim.
  function onMediaLoaded() {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }

  function loadOlder() {
    prevHeight.current = ref.current?.scrollHeight ?? null
    onLoadOlder()
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-[22px]"
      style={{
        background: 'radial-gradient(700px 360px at 60% 0%, #f0faea, transparent 70%), #f6f7ef',
      }}
    >
      {error && !loading && messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Warning size={26} className="text-light-neutral-500" />
          <p className="text-[13px] text-light-neutral-400">Não foi possível carregar as mensagens.</p>
          <button type="button" onClick={onRetry} className="pc-btn pc-btn-secondary text-[12px]">
            <ArrowClockwise size={13} /> Tentar de novo
          </button>
        </div>
      ) : loading && messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-light-accent-400">
          <Spinner size={20} />
        </div>
      ) : (
        <>
          {hasMore ? (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="self-center rounded-pill border border-solid border-light-divider bg-light-surface px-2.5 py-1 text-[11px] text-light-neutral-500 hover:text-light-text disabled:opacity-60"
            >
              {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          ) : null}
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt) ? (
                <span className="self-center rounded-pill border border-solid border-light-divider bg-light-surface px-2.5 py-1 text-[11px] text-light-neutral-500">
                  {formatDayLabel(m.createdAt)}
                </span>
              ) : null}
              <MessageBubble message={m} agentName={agentName} onRetryMedia={onRetryMedia} onMediaLoaded={onMediaLoaded} />
            </Fragment>
          ))}
          {typing ? (
            <div className="flex justify-end">
              <div
                className="flex animate-zfPulse items-center gap-1.5 border border-solid border-light-accent-700 bg-light-accent-900 px-[13px] py-[9px] text-xs text-light-accent-300"
                style={{ borderRadius: '14px 14px 4px 14px' }}
              >
                <Sparkle size={11} weight="fill" />
                {agentName} está digitando…
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
