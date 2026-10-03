'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

const AUTOSAVE_MS = 800

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Anotações com salvamento automático (debounce de 800 ms).
 * Use com `key={contactId}`: ao trocar de contato o componente desmonta e o texto pendente é enviado.
 */
export function ContactNotes({
  contactId,
  initial,
  save,
  onSaved,
  onError,
}: {
  contactId: string
  initial: string
  save: (id: string, notes: string, keepalive: boolean) => Promise<void>
  onSaved: (id: string, notes: string) => void
  onError: () => void
}) {
  const fieldId = useId()
  const [text, setText] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')

  const latest = useRef(initial)
  const persisted = useRef(initial)
  const timer = useRef<number | undefined>(undefined)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const cb = useRef({ save, onSaved, onError })

  useEffect(() => {
    cb.current = { save, onSaved, onError }
  })

  // Salvamentos em série, para a ordem de gravação seguir a ordem de digitação.
  const flush = useCallback(
    (keepalive = false) => {
      window.clearTimeout(timer.current)
      chain.current = chain.current.then(async () => {
        const value = latest.current
        if (value === persisted.current) return
        setState('saving')
        try {
          await cb.current.save(contactId, value, keepalive)
          persisted.current = value
          cb.current.onSaved(contactId, value)
          setState(latest.current === value ? 'saved' : 'saving')
        } catch {
          setState('error')
          cb.current.onError()
        }
      })
    },
    [contactId],
  )

  useEffect(() => {
    const onHide = () => flush(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flush(true)
    }
  }, [flush])

  const onChange = (value: string) => {
    setText(value)
    latest.current = value
    setState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => flush(), AUTOSAVE_MS)
  }

  return (
    <div className="mt-0.5">
      <div className="mb-[5px] flex items-baseline justify-between">
        <label htmlFor={fieldId} className="pc-label !mb-0">
          Anotações
        </label>
        <span
          role="status"
          aria-live="polite"
          className={state === 'error' ? 'text-[10.5px] text-[#b3402f]' : 'text-[10.5px] text-light-neutral-500'}
        >
          {state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo' : state === 'error' ? 'Não salvou' : ''}
        </span>
      </div>
      <textarea
        id={fieldId}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => flush()}
        rows={3}
        placeholder="Preferências, alergias, datas importantes…"
        className="pc-input !min-h-0 resize-y leading-[1.45]"
      />
    </div>
  )
}
