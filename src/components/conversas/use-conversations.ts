'use client'

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hand, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { HANDOFF_WINDOW_EVENT } from '@/components/app/handoff'
import type { HandoffRequestedPayload } from '@/components/app/handoff'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { useRawSocketEvent, useSocketEvent } from '@/lib/socket-client'
import type { ConversationModeKind, MediaTypeKind, MessageDTO } from '@/lib/types'
import { MEDIA_LABEL } from '@/server/media/mime'
import type { ConversationFilter, ConversationItem } from './types'

const PAGE_SIZE = 50
// Mesmo limite de GET /api/conversations: ao chegar nele, há conversas que só a busca alcança.
const LIST_LIMIT = 200

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

/** Envio multipart com progresso (fetch ainda não informa o andamento do upload). */
function uploadMedia(url: string, form: FormData, onProgress: (pct: number) => void): Promise<MessageDTO> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)))
    }
    xhr.onerror = () => reject(new ApiError(0, undefined, 'Sem conexão'))
    xhr.ontimeout = () => reject(new ApiError(0, undefined, 'Tempo esgotado'))
    xhr.onload = () => {
      const data = xhr.response as (MessageDTO & { error?: string; code?: string }) | null
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        onProgress(100)
        resolve(data)
        return
      }
      redirectIfUnauthorized(xhr.status)
      reject(new ApiError(xhr.status, data?.code, data?.error ?? `Erro ${xhr.status}`))
    }
    xhr.timeout = 180_000
    xhr.send(form)
  })
}

const kindOfFile = (f: File): MediaTypeKind =>
  f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : f.type.startsWith('video/') ? 'video' : 'document'

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
  const { automations, agentName, toast, user } = useAppState()
  const iaOn = automations.ia
  const myId = user.id // Equipe: filtro "Minhas"

  const [items, setItems] = useState<ConversationItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState(false)
  const [truncated, setTruncated] = useState(false)
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

  // Busca no servidor (debounce): acha conversas que ficaram fora das 200 mais recentes da lista.
  const [remote, setRemote] = useState<{ key: string; items: ConversationItem[] } | null>(null)
  const searchText = query.trim()
  useEffect(() => {
    if (!searchText) {
      setRemote(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: searchText, filter })
      api<ConversationItem[]>(`/api/conversations?${params.toString()}`)
        .then((list) => {
          if (cancelled) return
          setRemote({ key: `${filter}|${searchText}`, items: list })
          // Conversas achadas além das 200 da lista entram na memória, para poder abri-las.
          setItems((l) => {
            const known = new Set(l.map((c) => c.id))
            const extra = list.filter((c) => !known.has(c.id))
            return extra.length ? [...l, ...extra].sort(byRecent) : l
          })
        })
        .catch(() => {})
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchText, filter])

  const visible = useMemo(() => {
    const q = searchText.toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const matches = (c: ConversationItem) => {
      if (filter === 'nao_lidas' && c.unread <= 0) return false
      if (filter === 'com_ia' && c.mode !== 'ia') return false
      if (filter === 'minhas' && (!myId || c.assignee?.id !== myId)) return false
      if (!q) return true
      if (c.nome.toLowerCase().includes(q)) return true
      return qDigits.length >= 3 && /^[\d\s()+-]+$/.test(q) && (c.telefone ?? '').replace(/\D/g, '').includes(qDigits)
    }
    const local = items.filter(matches)
    if (!q || !remote || remote.key !== `${filter}|${searchText}`) return local
    // Resultado do servidor + o que já está na memória (mais novo, vindo do tempo real).
    const byId = new Map(items.map((c) => [c.id, c]))
    const merged = new Map<string, ConversationItem>()
    for (const r of remote.items) {
      const fresh = byId.get(r.id) ?? r
      if (matches(fresh)) merged.set(r.id, fresh)
    }
    for (const c of local) merged.set(c.id, c)
    return Array.from(merged.values()).sort(byRecent)
  }, [items, filter, searchText, remote, myId])

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
      .then(async (loaded) => {
        let list = loaded
        const preferred = preferredRef.current
        let wanted = preferred ? list.find((c) => c.id === preferred) : undefined
        if (preferred && !wanted) {
          // Conversa pedida por ?c= que ficou fora das 200 da lista (ex.: recém-criada, ainda sem mensagens).
          const one = await api<ConversationItem[]>(`/api/conversations?id=${encodeURIComponent(preferred)}`).catch(() => [])
          if (one[0]) {
            wanted = one[0]
            list = [...list, one[0]].sort(byRecent)
          }
        }
        if (cancelled) return
        setItems(list)
        setTruncated(loaded.length >= LIST_LIMIT)
        if (!activeIdRef.current) {
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

  // Reconexão do socket (servidor reiniciou, rede caiu): eventos podem ter se perdido, então ressincroniza.
  const socketWasDown = useRef(false)
  useRawSocketEvent('disconnect', () => {
    socketWasDown.current = true
  })
  useRawSocketEvent('connect', () => {
    if (!socketWasDown.current) return
    socketWasDown.current = false
    api<ConversationItem[]>('/api/conversations')
      .then((list) => setItems(list))
      .catch(() => {})
    const id = activeIdRef.current
    if (!id) return
    api<MessageDTO[]>(`/api/conversations/${id}/messages`)
      .then((page) => {
        if (activeIdRef.current !== id) return
        setMessages((cur) => {
          const byId = new Map(cur.map((m) => [m.id, m]))
          for (const m of page) byId.set(m.id, m)
          return Array.from(byId.values()).sort((a, b) =>
            a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? -1 : 1,
          )
        })
      })
      .catch(() => {})
  })

  // Tempo real
  useSocketEvent('conversation.updated', ({ conversation }) => {
    const item = conversation as ConversationItem
    setItems((l) => {
      const prev = l.find((c) => c.id === item.id)
      // Mantém o autor da última mensagem se o payload não trouxe.
      return upsert(l, { ...item, lastMessageAuthor: item.lastMessageAuthor ?? prev?.lastMessageAuthor ?? null })
    })
  })

  // Equipe: o seletor de responsável (chat-header) avisa a lista pelo window, sem depender só do socket.
  useEffect(() => {
    const onAssigned = (e: Event) => {
      const item = (e as CustomEvent<ConversationItem>).detail
      setItems((l) => {
        const prev = l.find((c) => c.id === item.id)
        return upsert(l, { ...item, lastMessageAuthor: item.lastMessageAuthor ?? prev?.lastMessageAuthor ?? null })
      })
    }
    window.addEventListener('pearchat:conversation-updated', onAssigned)
    return () => window.removeEventListener('pearchat:conversation-updated', onAssigned)
  }, [])

  useSocketEvent('message.received', ({ conversationId, message }) => {
    if (conversationId !== activeIdRef.current) return
    setMessages((cur) => (cur.some((m) => m.id === message.id) ? cur : [...cur, message]))
    if (!iaOnRef.current && message.direction === 'in') markRead(conversationId)
  })

  // Mídia baixada, transcrição pronta ou erro: troca a mensagem no lugar.
  useSocketEvent('message.updated', ({ conversationId, message }) => {
    if (conversationId !== activeIdRef.current) return
    setMessages((cur) => cur.map((m) => (m.id === message.id ? { ...m, ...message } : m)))
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
      // Chave de idempotência deste envio: o servidor devolve a mesma mensagem se a requisição se repetir.
      const clientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
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
          body: JSON.stringify({ body, clientId }),
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

  /** Envia um arquivo (com legenda opcional) pela conversa aberta. Devolve true se enviou. */
  const sendMedia = useCallback(
    async (file: File, caption: string, onProgress: (pct: number) => void): Promise<boolean> => {
      const conv = items.find((c) => c.id === activeIdRef.current)
      if (!conv) return false
      const tookOver = iaOn && conv.mode === 'ia'
      const kind = kindOfFile(file)
      const text = kind === 'audio' ? '' : caption.trim()
      const tmpId = `tmp-${++tmpSeq.current}`
      const clientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      const nowIso = new Date().toISOString()
      const optimistic: MessageDTO = {
        id: tmpId,
        conversationId: conv.id,
        direction: 'out',
        author: 'user',
        body: text || MEDIA_LABEL[kind],
        mediaUrl: null,
        status: 'pendente',
        createdAt: nowIso,
        mediaType: kind,
        mediaMime: file.type,
        mediaSize: file.size,
        mediaName: file.name,
        mediaStatus: 'pendente',
      }
      const snapshot = conv
      setMessages((cur) => [...cur, optimistic])
      setItems((l) =>
        upsert(l, { ...conv, unread: 0, mode: iaOn ? 'humano' : conv.mode, lastMessagePreview: text, lastMessageMedia: { type: kind, durationSec: null }, lastMessageAt: nowIso, lastMessageAuthor: 'user' }),
      )
      try {
        const form = new FormData()
        form.append('file', file, file.name)
        if (text) form.append('caption', text)
        form.append('clientId', clientId)
        const saved = await uploadMedia(`/api/conversations/${conv.id}/media`, form, onProgress)
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
        const icon = createElement(WarningCircle, { size: 18, weight: 'fill' })
        if (err?.code === 'ARQUIVO_GRANDE') toast({ icon, title: 'Arquivo grande demais', text: 'O limite é 16 MB por arquivo.' })
        else if (err?.code === 'ARQUIVO_INVALIDO') toast({ icon, title: 'Arquivo não permitido', text: err.message })
        else if (err?.code === 'NAO_SUPORTADO') toast({ icon, title: 'Envio de arquivos indisponível', text: 'Esta conexão ainda não envia arquivos.' })
        else if (err?.code === 'FORA_DA_JANELA_24H') toast({ icon, title: 'Fora da janela de 24 h', text: 'Depois de 24 h sem resposta do cliente, só é possível enviar modelos aprovados.' })
        else if (err?.status === 409) toast({ icon, title: 'WhatsApp desconectado', text: 'Conecte o WhatsApp para enviar mensagens.' })
        else {
          toast({ icon, title: 'Não foi possível enviar o arquivo', text: 'Tente novamente em instantes.' })
          if (err?.status === 502) void loadMessages(conv.id)
        }
        return false
      }
    },
    [items, iaOn, agentName, toast, loadMessages],
  )

  /** "Tentar de novo" de uma mídia recebida que não carregou. */
  const retryMedia = useCallback(
    async (messageId: string) => {
      const convId = activeIdRef.current
      if (!convId) return
      setMessages((cur) => cur.map((m) => (m.id === messageId ? { ...m, mediaStatus: 'pendente' } : m)))
      try {
        const updated = await api<MessageDTO>(`/api/conversations/${convId}/messages/${messageId}/media/retry`, { method: 'POST' })
        setMessages((cur) => cur.map((m) => (m.id === messageId ? { ...m, ...updated } : m)))
      } catch {
        setMessages((cur) => cur.map((m) => (m.id === messageId ? { ...m, mediaStatus: 'erro' } : m)))
        toast({ icon: createElement(WarningCircle, { size: 18, weight: 'fill' }), title: 'Não foi possível carregar a mídia', text: 'Tente novamente em instantes.' })
      }
    },
    [toast],
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
    truncated,
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
    sendMedia,
    retryMedia,
    setMode,
  }
}
