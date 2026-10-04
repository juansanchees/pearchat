'use client'

import { forwardRef, useImperativeHandle, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

export const EMPTY_CODE = ['', '', '', '', '', '']

export type CodeBoxesHandle = { focus: (i?: number) => void }

type Props = {
  code: string[]
  onChange: (next: string[]) => void
  /** Chamado quando os 6 dígitos ficam completos (digitando ou colando). */
  onComplete: (next: string[]) => void
  /** Enter com o código ainda incompleto ou completo. */
  onEnter?: () => void
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

// Campos de 6 dígitos (colar, backspace e avanço automático), compartilhados pelas telas de código.
export const CodeBoxes = forwardRef<CodeBoxesHandle, Props>(function CodeBoxes(
  { code, onChange, onComplete, onEnter, disabled, invalid, describedBy },
  ref,
) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  useImperativeHandle(ref, () => ({ focus: (i = 0) => refs.current[i]?.focus() }), [])

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '')
    const next = code.slice()
    next[i] = d.slice(-1)
    onChange(next)
    if (d && i < 5) refs.current[i + 1]?.focus()
    if (d && next.every(Boolean)) onComplete(next)
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'Enter') onEnter?.()
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6)
    if (!t) return
    e.preventDefault()
    const next = EMPTY_CODE.map((_, j) => t[j] ?? '')
    onChange(next)
    refs.current[Math.min(t.length, 6) - 1]?.focus()
    if (t.length === 6) onComplete(next)
  }

  return (
    <div role="group" aria-label="Código de 6 dígitos" className="grid grid-cols-6 gap-2">
      {code.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={c}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Dígito ${i + 1} de 6`}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? describedBy : undefined}
          className="pc-code-box h-[54px] w-full min-w-0 rounded-md border bg-light-surface text-center text-[22px] font-medium text-light-text transition-[border-color] duration-150"
          style={{
            borderColor: invalid ? '#c9806b' : c ? '#7acc4a' : '#e3e7d6',
            background: c ? '#f0faea' : '#ffffff',
          }}
        />
      ))}
    </div>
  )
})
