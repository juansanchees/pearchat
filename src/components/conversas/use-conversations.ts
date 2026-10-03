'use client'

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hand, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { HANDOFF_WINDOW_EVENT } from '@/components/app/handoff'
import type { HandoffRequestedPayload } from '@/components/app/handoff'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { useSocketEvent } from '@/lib/socket-client'
import type { ConversationModeKind, MessageDTO } from '@/lib/types'
import type { ConversationFilter, ConversationItem } from './types'

const PAGE_SIZE = 50

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    redirectIfUnauthorized(res.status)
    const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
    throw new ApiError(res.status, data?.code, data?.error ?? `Erro ${res.status}`)
  }
  return (await res.json()) as T
}

const byRecent = (a: ConversationItem, b: ConversationItem) => {
  if (a.lastMessageAt === b.lastMessageAt) return 0
  if (!a.lastMessageAt) return 1
  if (!b.lastMessageAt) return -1
  return a.lastMessageAt < b.lastMessageAt ? 1 : -1
}

const upsert = (list: ConversationItem[], item: ConversationItem) =>
  [...list.filter((c) => c.id !== item.id), item].sort(byRecent)

/** preferredId: conversa a abrir ao carregar (vinda de ?c=); senão abre a primeira. */
export function useConversations(preferredId: string | null = null) {
  const { automations, agentName, toast } = useAppState()
  const iaOn = automations.ia

  const [items, setItems] = useState<ConversationItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState(false)
  const [listKey, setListKey] = useState(0)
  const [messagesError, setMessagesError] = useState(false)
  const [filter, setFilter] = useState<ConversationFilter>('todas')
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const activeIdRef = useRef<string | null>(null)
  const preferredRef = useRef(preferredId)
  const iaOnRef = useRef(iaOn)
  iaOnRef.current = iaOn
  const tmpSeq = useRef(0)

  const active = useMemo(() => items.find((c) => c.id === activeId) ?? null, [items, activeId])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((c) => {
      if (filter === 'nao_lidas' && c.unread <= 0) return false
      if (filter === 'com_ia' && c.mode !== 'ia') return false
      if (q && !c.nome.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, filter, query])

  const markRead = useCallback((id: string) => {
    setItems((l) => l.map((c) => (c.id === id && c.unread > 0 ? { ...c, unread: 0 } : c)))
    api(`/api/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
  }, [])

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true)
    setMessagesError(false)
    try {
      const page = await api<MessageDTO[]>(`/api/conversations/${id}/messages`)
      if (activeIdRef.current !== id) return
      setMessages(page)
      setHasMore(page.length >= PAGE_SIZE)
    } catch {
      if (activeIdRef.current === id) {
        setMessages([])
        setMessagesError(true)
      }
    } finally {
      if (activeIdRef.current === id) setLoadingMessages(false)
    }
  }, [])

  const select = useCallback(
    (id: string) => {
      activeIdRef.current = id
      setActiveId(id)
      setMessages([])
      setHasMore(false)
      setMessagesError(false)
      void loadMessages(id)
      // Com a IA ligada, abrir a conversa não zera as não lidas (regra do protótipo).
      if (!iaOnRef.current) markRead(id)
    },
    [loadMessages, markRead],
  )

  const loadOlder = useCallback(async () => {
    const id = activeIdRef.current
    const oldest = messages[0]
    if (!id || !oldest || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await api<MessageDTO[]>(`/api/conversations/${id}/messages?cursor=${encodeURIComponent(oldest.id)}`)
      if (activeIdRef.current !== id) return
      setMessages((cur) => {
        const known = new Set(cur.map((m) => m.id))
        return [...page.filter((m) => !known.has(m.id)), ...cur]
      })
      setHasMore(page.length >= PAGE_SIZE)
    } catch {
      toast({ icon: createElement(WarningCircle, { size: 18, weight: 'fill' }), title: 'Não foi possível carregar o histórico', text: 'Tente novamente.' })
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, loadingOlder, toast])

  // Carga da lista e seleção inicial (a conversa de ?c=, se existir; senão a primeira).
  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    setListError(false)
    api<ConversationItem[]>('/api/conversations')
      .then((list) => {
        if (cancelled) return
        setItems(list)
        if (!activeIdRef.current) {
          const wanted = preferredRef.current ? list.find((c) => c.id === preferredRef.current) : undefined
          const first = wanted ?? list[0]
          if (first) select(first.id)
        }
      })
      .catch(() => {
        if (!cancelled) setListError(true)
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey])

  const reloadList = useCallback(() => setListKey((k) => k + 1), [])

  const retryMessages = useCallback(() => {
    if (activeIdRef.current) void loadMessages(activeIdRef.current)
  }, [loadMessages])

  // A IA passou a conversa para o usuário: atualiza a pílula de modo.
  useEffect(() => {
    const onHandoff = (e: Event) => {
      const { conversationId } = (e as CustomEvent<HandoffRequestedPayload>).detail
      setItems((l) => l.map((c) => (c.id === conversationId ? { ...c, mode: 'humano' } : c)))
    }
    window.addEventListener(HANDOFF_WINDOW_EVENT, onHandoff)
    return () => window.removeEventListener(HANDOFF_WINDOW_EVENT, onHandoff)
  }, [])

  // Tempo real
  useSocketEvent('conversation.updated', ({ conversation }) => {
    const item = conversation as ConversationItem
    setItems((l) => {
      const prev = l.find((c) => c.id === item.id)
      // Mantém o autor da última mensagem se o payload não trouxe.
      return upsert(l, { ...item, lastMessageAuthor: item.lastMessageAuthor ?? prev?.lastMessageAuthor ?? null })
    })
  })

  useSocketEvent('message.received', ({ conversationId, message }) => {
    if (conversationId !== activeIdRef.current) return
    setMessages((cur) => (cur.some((m) => m.id === message.id) ? cur : [...cur, message]))
    if (!iaOnRef.current && message.direction === 'in') markRead(conversationId)
  })

  useSocketEvent('message.status', ({ conversationId, messageId, status }) => {
    if (conversationId !== activeIdRef.current) return
    setMessages((cur) => cur.map((m) => (m.id === messageId ? { ...m, status } : m)))
  })

  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const body = raw.trim()
      const conv = items.find((c) => c.id === activeIdRef.current)
      if (!body || !conv) return false

      const tookOver = iaOn && conv.mode === 'ia'
      const tmpId = `tmp-${++tmpSeq.current}`
      const nowIso = new Date().toISOString()
      const optimistic: MessageDTO = {
        id: tmpId,
        conversationId: conv.id,
        direction: 'out',
        author: 'user',
        body,
        mediaUrl: null,
        status: 'pendente',
        createdAt: nowIso,
      }
      const snapshot = conv
      setMessages((cur) => [...cur, optimistic])
      setItems((l) =>
        upsert(l, {
          ...conv,
          unread: 0,
          mode: iaOn ? 'humano' : conv.mode,
          lastMessagePreview: body,
          lastMessageAt: nowIso,
          lastMessageAuthor: 'user',
        }),
      )

      try {
        const saved = await api<MessageDTO>(`/api/conversations/${conv.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        })
        setMessages((cur) => {
          const withoutTmp = cur.filter((m) => m.id !== tmpId)
          return withoutTmp.some((m) => m.id === saved.id) ? withoutTmp : [...withoutTmp, saved]
        })
        if (tookOver) {
          toast({
            icon: createElement(Hand, { size: 18, weight: 'fill' }),
            title: 'Você assumiu a conversa',
            text: `${agentName} pausou para ${conv.nome}`,
          })
        }
        return true
      } catch (e) {
        setMessages((cur) => cur.filter((m) => m.id !== tmpId))
        setItems((l) => upsert(l, snapshot))
        const err = e instanceof ApiError ? e : null
        if (err?.code === 'FORA_DA_JANELA_24H') {
          toast({
            icon: createElement(WarningCircle, { size: 18, weight: 'fill' }),
            title: 'Fora da janela de 24 h',
            text: 'Depois de 24 h sem resposta do cliente, só é possível enviar modelos aprovados.',
          })
        } else if (err?.status === 409) {
          toast({
            icon: createElement(WarningCircle, { size: 18, weight: 'fill' }),
            title: 'WhatsApp desconectado',
            text: 'Conecte o WhatsApp para enviar mensagens.',
          })
        } else {
          toast({
            icon: createElement(WarningCircle, { size: 18, weight: 'fill' }),
            title: 'Não foi possível enviar',
            text: 'Tente novamente em instantes.',
          })
          // Uma mensagem pode ter sido gravada como "falhou" no servidor: recarrega.
          if (err?.status === 502) void loadMessages(conv.id)
        }
        return false
      }
    },
    [items, iaOn, agentName, toast, loadMessages],
  )

  const setMode = useCallback(
    async (mode: ConversationModeKind) => {
      const conv = items.find((c) => c.id === activeIdRef.current)
      if (!conv) return
      try {
        const updated = await api<ConversationItem>(`/api/conversations/${conv.id}/mode`, {
          method: 'PATCH',
          body: JSON.stringify({ mode }),
        })
        setItems((l) => upsert(l, { ...conv, ...updated }))
        if (mode === 'humano') {
          toast({
            icon: createElement(Hand, { size: 18, weight: 'fill' }),
            title: 'Você assumiu a conversa',
            text: `${agentName} pausou para ${conv.nome}`,
          })
        } else {
          toast({
            icon: createElement(Sparkle, { size: 18, weight: 'fill' }),
            title: 'Conversa devolvida',
            text: `${agentName} volta a responder ${conv.nome}`,
          })
        }
      } catch {
        toast({
          icon: createElement(WarningCircle, { size: 18, weight: 'fill' }),
          title: 'Não foi possível alterar a conversa',
          text: 'Tente novamente em instantes.',
        })
      }
    },
    [items, agentName, toast],
  )

  return {
    items,
    visible,
    loadingList,
    listError,
    reloadList,
    messagesError,
    retryMessages,
    filter,
    setFilter,
    query,
    setQuery,
    active,
    activeId,
    select,
    messages,
    loadingMessages,
    hasMore,
    loadingOlder,
    loadOlder,
    send,
    setMode,
  }
}
