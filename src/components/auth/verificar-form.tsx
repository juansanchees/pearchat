'use client'

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { EnvelopeSimpleOpen } from '@phosphor-icons/react'
import { AuthTitle, IconBadge } from './auth-shell'
import { primaryBtn } from './fields'

// Interface da confirmação de e-mail por código de 6 dígitos.
// O back-end desse fluxo ainda não existe: nenhum código é aceito e nada é confirmado.
export function VerificarForm({ email }: { email?: string }) {
  const [code, setCode] = useState<string[]>(['', '', '', '', '', ''])
  const [erro, setErro] = useState<string>()
  const [aviso, setAviso] = useState(false)
  const [segundos, setSegundos] = useState(45)
  const refs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (segundos <= 0) return
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [segundos])

  function confirmar(c = code) {
    if (!c.every(Boolean)) {
      setErro('Digite os 6 dígitos.')
      return
    }
    setErro(undefined)
    setAviso(true)
  }

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '')
    const next = code.slice()
    next[i] = d.slice(-1)
    setCode(next)
    setErro(undefined)
    setAviso(false)
    if (d && i < 5) refs.current[i + 1]?.focus()
    if (d && i === 5 && next.every(Boolean)) confirmar(next)
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'Enter') confirmar()
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6)
    if (!t) return
    e.preventDefault()
    const next = ['', '', '', '', '', ''].map((_, j) => t[j] ?? '')
    setCode(next)
    setErro(undefined)
    refs.current[Math.min(t.length, 6) - 1]?.focus()
    if (t.length === 6) confirmar(next)
  }

  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <IconBadge>
        <EnvelopeSimpleOpen size={24} aria-hidden="true" />
      </IconBadge>
      <AuthTitle
        sub={
          <>
            Enviamos um código de 6 dígitos para{' '}
            <span className="font-medium text-light-text">{email || 'seu e-mail'}</span>.
          </>
        }
      >
        Confirme seu e-mail
      </AuthTitle>
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
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`Dígito ${i + 1} de 6`}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'codigo-erro' : undefined}
            className="pc-code-box h-[54px] w-full min-w-0 rounded-md border bg-light-surface text-center text-[22px] font-medium text-light-text transition-[border-color] duration-150"
            style={{
              borderColor: erro ? '#c9806b' : c ? '#b3ca52' : '#e3e7d6',
              background: c ? '#f3f7e2' : '#ffffff',
            }}
          />
        ))}
      </div>
      {erro && (
        <p id="codigo-erro" role="alert" className="-mt-2.5 text-[11.5px] text-[#a0452f]">
          {erro}
        </p>
      )}
      <button type="button" onClick={() => confirmar()} className={primaryBtn}>
        Confirmar
      </button>
      <div className="flex justify-between gap-2.5 text-[12.5px]">
        <button
          type="button"
          disabled={segundos > 0}
          onClick={() => {
            setAviso(true)
            setSegundos(45)
          }}
          className={segundos > 0 ? 'text-light-neutral-500' : 'text-light-accent-200'}
        >
          {segundos > 0 ? `Reenviar código em 0:${String(segundos).padStart(2, '0')}` : 'Reenviar código'}
        </button>
        <Link href="/registro" className="text-light-neutral-500 hover:text-light-neutral-300">
          Trocar e-mail
        </Link>
      </div>
      <div
        role="status"
        className="rounded-md border border-dashed border-light-divider bg-light-surface px-3 py-2.5 text-[11.5px] text-light-neutral-500"
      >
        {aviso
          ? 'A confirmação por código ainda não está disponível. Sua conta já fica ativa assim que é criada: é só entrar.'
          : 'Esta etapa ainda não está disponível no PearChat. Sua conta já fica ativa assim que é criada.'}
      </div>
    </div>
  )
}
