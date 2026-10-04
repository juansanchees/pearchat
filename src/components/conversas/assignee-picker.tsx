'use client'

import { useEffect, useRef, useState } from 'react'
import { CaretDown, Check, UserCircleMinus, UserPlus } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { Avatar } from '@/components/pear'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import type { ConversationItem } from './types'

type Person = { id: string; nome: string; fotoUrl: string | null; papel: string; voce: boolean }

const item =
  'flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-[10px] py-[8px] text-left text-[12.5px] text-light-text hover:bg-[rgba(29,33,23,.07)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Seletor discreto de "Responsável" no cabeçalho da conversa (Equipe): avatar + nome, ou "Sem responsável".
 * A lista traz só as pessoas com acesso a este WhatsApp (o servidor confere de novo ao atribuir).
 */
export function AssigneePicker({ conversation }: { conversation: ConversationItem }) {
  const { toast, user } = useAppState()
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = conversation.assignee ?? null

  useEffect(() => {
    if (!open) return
    let alive = true
    fetch('/api/team/people', { cache: 'no-store' })
      .then((r) => {
        redirectIfUnauthorized(r.status)
        return r.ok ? (r.json() as Promise<Person[]>) : null
      })
      .then((p) => {
        if (alive && p) setPeople(p)
      })
      .catch(() => {})
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      alive = false
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function assign(userId: string | null) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/assignee`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      redirectIfUnauthorized(res.status)
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Tente novamente em instantes.'
        toast({ title: 'Não foi possível atribuir', text: msg })
        return
      }
      if (data && typeof data === 'object') window.dispatchEvent(new CustomEvent('pearchat:conversation-updated', { detail: data }))
      setOpen(false)
    } catch {
      toast({ title: 'Não foi possível atribuir', text: 'Verifique sua conexão e tente novamente.' })
    } finally {
      setBusy(false)
    }
  }

  const isMine = !!user.id && current?.id === user.id

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Responsável pela conversa"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[190px] items-center gap-1.5 rounded-pill border border-solid border-light-divider bg-light-surface py-[3px] pl-[4px] pr-2 text-[11.5px] text-light-neutral-400 hover:bg-[rgba(29,33,23,.07)]"
      >
        {current ? (
          <Avatar name={current.nome} src={current.fotoUrl} size={20} className="!text-[8px]" />
        ) : (
          <UserCircleMinus size={20} className="text-light-neutral-500" aria-hidden="true" />
        )}
        <span className="truncate">{current ? current.nome : 'Sem responsável'}</span>
        <CaretDown size={10} aria-hidden="true" className="flex-none" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-[34px] z-50 w-[240px] rounded-lg border border-solid border-light-divider bg-light-surface p-[6px] shadow-[0_12px_32px_rgba(0,0,0,.28)]">
          <div className="px-[10px] pb-1 pt-1 text-[10.5px] uppercase tracking-[0.1em] text-light-neutral-500">Responsável</div>
          {!isMine && user.id && (
            <button type="button" role="menuitem" className={item} disabled={busy} onClick={() => void assign(user.id ?? null)}>
              <UserPlus size={15} aria-hidden="true" />
              Atribuir a mim
            </button>
          )}
          {(people ?? []).map((p) => (
            <button key={p.id} type="button" role="menuitem" className={item} disabled={busy} onClick={() => void assign(p.id)}>
              <Avatar name={p.nome} src={p.fotoUrl} size={20} className="!text-[8px]" />
              <span className="min-w-0 flex-1 truncate">
                {p.nome}
                {p.voce ? ' (você)' : ''}
              </span>
              {current?.id === p.id && <Check size={13} weight="bold" aria-hidden="true" />}
            </button>
          ))}
          {people === null && <div className="px-[10px] py-2 text-[11.5px] text-light-neutral-500">Carregando…</div>}
          {current && (
            <button type="button" role="menuitem" className={item} disabled={busy} onClick={() => void assign(null)}>
              <UserCircleMinus size={15} aria-hidden="true" />
              Sem responsável
            </button>
          )}
        </div>
      )}
    </div>
  )
}
