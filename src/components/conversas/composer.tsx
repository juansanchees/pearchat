'use client'

import { PaperPlaneRight, Paperclip } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export function Composer({
  iaAnswering,
  onSend,
}: {
  iaAnswering: boolean
  onSend: (text: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')
  // Texto em envio: Enter repetido/duplo clique com o mesmo texto não dispara outro envio antes de o primeiro terminar.
  const inFlight = useRef<string | null>(null)

  async function submit() {
    const text = draft.trim()
    if (!text || inFlight.current === text) return
    inFlight.current = text
    setDraft('')
    let ok = false
    try {
      ok = await onSend(text)
    } finally {
      inFlight.current = null
    }
    // Rollback: devolve o texto ao campo se nada novo foi digitado.
    if (!ok) setDraft((cur) => (cur === '' ? text : cur))
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex items-center gap-2.5 border-0 border-t border-solid border-light-divider bg-light-surface px-4 py-3">
      <button
        type="button"
        title="Anexar"
        aria-label="Anexar"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-light-accent-500 hover:bg-[rgba(46,154,72,.10)]"
      >
        <Paperclip size={17} />
      </button>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={4096}
        placeholder={iaAnswering ? 'Escreva para assumir a conversa' : 'Digite uma mensagem'}
        aria-label="Mensagem"
        className="min-h-9 min-w-0 flex-1 rounded-md border border-solid border-light-divider bg-light-surface px-2.5 py-1.5 text-sm text-light-text caret-light-accent-500 hover:border-light-neutral-500 focus-visible:border-light-accent-500 focus-visible:outline-none"
      />
      <button
        type="button"
        onClick={() => void submit()}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-solid border-light-accent-500 px-3.5 py-2 text-sm font-medium leading-tight text-light-accent-300 hover:bg-[rgba(46,154,72,.12)] active:bg-[rgba(46,154,72,.22)]"
      >
        <PaperPlaneRight size={16} />
        Enviar
      </button>
    </div>
  )
}
