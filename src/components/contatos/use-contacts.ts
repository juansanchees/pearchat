'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isAbort } from './api'
import type { Contact, ContactCounts, ContactFilter, ContactPatch, ContactsPage, NewContactInput } from './types'

const PAGE_SIZE = 30
const DEBOUNCE_MS = 300
const EMPTY_COUNTS: ContactCounts = { todos: 0, clientes: 0, leads: 0, vip: 0 }

export type ListStatus = 'loading' | 'ready' | 'error'

function listUrl(q: string, filter: ContactFilter, cursor?: string): string {
  const p = new URLSearchParams({ take: String(PAGE_SIZE) })
  if (q) p.set('q', q)
  if (filter !== 'todos') p.set('tag', filter)
  if (cursor) p.set('cursor', cursor)
  return `/api/contacts?${p.toString()}`
}

export function useContacts() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<ContactFilter>('todos')
  const [items, setItems] = useState<Contact[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<ContactCounts>(EMPTY_COUNTS)
  const [status, setStatus] = useState<ListStatus>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<Contact | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const silentRef = useRef(false)
  const moreCtrl = useRef<AbortController | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [query])

  // Carga da primeira página; respostas obsoletas são abortadas.
  useEffect(() => {
    const ctrl = new AbortController()
    moreCtrl.current?.abort()
    setLoadingMore(false)
    if (!silentRef.current) setStatus('loading')
    silentRef.current = false
    api<ContactsPage>(listUrl(debounced, filter), { signal: ctrl.signal })
      .then((page) => {
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setTotal(page.total)
        setCounts(page.counts)
        setSelected((cur) => cur ?? page.items[0] ?? null)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setStatus('error')
      })
    return () => ctrl.abort()
  }, [debounced, filter, reloadKey])

  const reload = useCallback((silent = false) => {
    silentRef.current = silent
    setReloadKey((k) => k + 1)
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    const ctrl = new AbortController()
    moreCtrl.current = ctrl
    setLoadingMore(true)
    try {
      const page = await api<ContactsPage>(listUrl(debounced, filter, nextCursor), { signal: ctrl.signal })
      setItems((cur) => {
        const known = new Set(cur.map((c) => c.id))
        return [...cur, ...page.items.filter((c) => !known.has(c.id))]
      })
      setNextCursor(page.nextCursor)
      setTotal(page.total)
      setCounts(page.counts)
      setLoadingMore(false)
    } catch (e) {
      if (!isAbort(e)) {
        setLoadingMore(false)
        throw e
      }
    }
  }, [nextCursor, loadingMore, debounced, filter])

  /** Aplica alterações já salvas no servidor à lista e ao contato selecionado. */
  const patchLocal = useCallback((id: string, patch: Partial<Contact>) => {
    setItems((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    setSelected((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur))
  }, [])

  const create = useCallback(
    async (input: NewContactInput): Promise<Contact> => {
      const created = await api<Contact>('/api/contacts', { method: 'POST', body: JSON.stringify(input) })
      setSelected(created)
      reload(true)
      return created
    },
    [reload],
  )

  const savePatch = useCallback(
    (id: string, patch: ContactPatch, opts?: { keepalive?: boolean }): Promise<Contact> =>
      api<Contact>(`/api/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        keepalive: opts?.keepalive,
      }),
    [],
  )

  return {
    query,
    setQuery,
    filter,
    setFilter,
    items,
    nextCursor,
    total,
    counts,
    status,
    loadingMore,
    selected,
    select: setSelected,
    reload,
    loadMore,
    patchLocal,
    create,
    savePatch,
  }
}
