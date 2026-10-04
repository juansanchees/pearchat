'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatCircle, ClockClockwise, PaperPlaneTilt, Sparkle, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { MenuButton } from '@/components/app/menu-button'
import { cn } from '@/lib/utils'
import type { AutomationKey } from '@/lib/types'
import { ChatHeader } from './chat-header'
import { Composer } from './composer'
import { ConversationList } from './conversation-list'
import { MessageThread } from './message-thread'
import { useConversations } from './use-conversations'
import { useHistoryImport } from './use-history-import'
import { WindowNotice } from './window-notice'
import { NumberMenu } from '@/components/whatsapp/number-menu'

const FALLBACK_SUBTITLE = 'Atendimento por WhatsApp'

export default function Conversas(): JSX.Element {
  const { automations, agentName, openDrawer, user, wa, toast } = useAppState()
  const router = useRouter()
  const sp = useSearchParams()
  const param = sp.get('c')
  // Conversa pedida na URL (/whatsapp?c=<id>) no primeiro render, para a lista já abrir nela.
  const [initialParam] = useState(param)
  const c = useConversations(initialParam)
  const history = useHistoryImport(c.reloadList)
  // Abaixo de 900 px a grade vira coluna única: lista -> conversa.
  const [showChat, setShowChat] = useState(false)
  // Arrastar um arquivo para a área da conversa: vira o anexo do campo de mensagem.
  const [dropped, setDropped] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)

  const { loadingList, listError, items, activeId, select } = c
  useEffect(() => {
    if (!param || loadingList || listError) return
    if (items.some((i) => i.id === param)) {
      if (activeId !== param) select(param)
      setShowChat(true)
    } else {
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Conversa não encontrada', text: 'Ela pode ter sido removida.' })
    }
    router.replace('/whatsapp')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, loadingList, listError])

  const chips: { key: AutomationKey; label: string; icon: ReactNode }[] = [
    { key: 'ia', label: `${agentName} ativa`, icon: <Sparkle size={12} /> },
    { key: 'disparos', label: 'Disparos automáticos', icon: <PaperPlaneTilt size={12} /> },
    { key: 'followup', label: 'Follow-up automático', icon: <ClockClockwise size={12} /> },
  ]

  const subtitle = wa.numero && user.empresa ? `${user.empresa} · ${wa.numero}` : FALLBACK_SUBTITLE
  const iaAnswering = automations.ia && c.active?.mode === 'ia'

  return (
    <div className="flex h-full min-h-0 flex-col bg-light-bg text-light-text">
      <div className="flex h-14 flex-none items-center gap-3.5 border-0 border-b border-solid border-light-divider bg-light-surface px-5 max-[899px]:px-3">
        <MenuButton />
        <div className="min-w-0">
          <div className="text-[14.5px] font-medium leading-tight">WhatsApp</div>
          <div className="truncate text-[11px] text-light-neutral-500">{subtitle}</div>
        </div>
        <NumberMenu onImport={history.canImport ? () => void history.start() : undefined} importing={history.importing} />
        <div className="flex-1" />
        <div className="flex flex-wrap justify-end gap-[7px] max-[899px]:hidden">
          {chips
            .filter((chip) => automations[chip.key])
            .map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => openDrawer(chip.key)}
                className="flex cursor-pointer items-center gap-[5px] rounded-[6px] border-0 bg-light-accent-800 px-2.5 py-[3px] text-[11px] tracking-[.02em] text-light-accent-100"
              >
                {chip.icon}
                {chip.label}
              </button>
            ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 animate-zfIn grid-cols-[minmax(260px,330px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] max-[899px]:grid-cols-1">
        <div className={cn('min-h-0', showChat ? 'hidden min-[900px]:contents' : 'contents')}>
        <ConversationList
          items={c.visible}
          total={c.items.length}
          truncated={c.truncated}
          loading={c.loadingList}
          error={c.listError}
          onRetry={c.reloadList}
          filter={c.filter}
          onFilter={c.setFilter}
          query={c.query}
          onQuery={c.setQuery}
          activeId={c.activeId}
          onSelect={(id) => {
            c.select(id)
            setShowChat(true)
          }}
          iaOn={automations.ia}
          agentName={agentName}
          history={history}
        />
        </div>

        <div
          className={cn('min-h-0 min-w-0 flex-col', showChat ? 'flex' : 'flex max-[899px]:hidden', dragging && 'outline-dashed outline-2 -outline-offset-4 outline-light-accent-500')}
          onDragOver={(e) => {
            if (!c.active || !Array.from(e.dataTransfer.types).includes('Files')) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            setDragging(false)
          }}
          onDrop={(e) => {
            setDragging(false)
            if (!c.active || e.dataTransfer.files.length === 0) return
            e.preventDefault()
            setDropped(e.dataTransfer.files[0] ?? null)
          }}
        >
          {c.active ? (
            <>
              <ChatHeader
                conversation={c.active}
                iaOn={automations.ia}
                followupOn={automations.followup}
                agentName={agentName}
                onMode={(m) => void c.setMode(m)}
                onBack={() => setShowChat(false)}
              />
              <MessageThread
                conversationId={c.active.id}
                messages={c.messages}
                loading={c.loadingMessages}
                error={c.messagesError}
                onRetry={c.retryMessages}
                hasMore={c.hasMore}
                loadingOlder={c.loadingOlder}
                onLoadOlder={() => void c.loadOlder()}
                typing={c.active.typing}
                agentName={agentName}
                onRetryMedia={(id) => void c.retryMedia(id)}
              />
              <WindowNotice conversationId={c.active.id} refreshKey={c.messages[c.messages.length - 1]?.id ?? ''} />
              <Composer
                key={c.active.id}
                iaAnswering={iaAnswering}
                onSend={c.send}
                onSendMedia={c.sendMedia}
                incomingFile={dropped}
                onIncomingConsumed={() => setDropped(null)}
              />
            </>
          ) : (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
              style={{ background: 'radial-gradient(700px 360px at 60% 0%, #f0faea, transparent 70%), #f6f7ef' }}
            >
              <ChatCircle size={36} className="text-light-neutral-600" />
              <p className="text-[14.5px] font-medium">
                {c.loadingList || c.items.length > 0 ? 'Selecione uma conversa' : 'Nenhuma conversa ainda'}
              </p>
              <p className="max-w-[320px] text-xs leading-relaxed text-light-neutral-500">
                {c.items.length > 0 || c.loadingList
                  ? 'Escolha um contato na lista para ver as mensagens.'
                  : history.importing
                    ? 'Estamos trazendo as conversas recentes do seu WhatsApp.'
                    : 'As conversas do seu WhatsApp aparecem aqui assim que os clientes escreverem.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
