'use client'

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { EnvelopeSimpleOpen } from '@phosphor-icons/react'
import { usarOutroEmailAction } from '@/app/(auth)/verificar-email/actions'
import { AuthTitle, IconBadge } from './auth-shell'
import { primaryBtn, Spinner } from './fields'

type Props = {
  email: string
  /** Serviço de e-mail configurado no servidor; sem ele a etapa fica indisponível. */
  configured: boolean
  /** Já existe um código vigente (não precisa pedir outro ao abrir a tela). */
  hasCode: boolean
  /** Segundos que faltam para poder reenviar. */
  initialCooldown: number
}

type ApiBody = { error?: string; code?: string; retryAfter?: number; ok?: boolean }

const EMPTY = ['', '', '', '', '', '']

// Confirmação de e-mail por código de 6 dígitos (POST /api/auth/email/send-code e /verify).
export function VerificarForm({ email, configured, hasCode, initialCooldown }: Props) {
  const [code, setCode] = useState<string[]>(EMPTY)
  const [erro, setErro] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [segundos, setSegundos] = useState(initialCooldown)
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [travado, setTravado] = useState(false) // código invalidado: precisa pedir outro
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const autoSent = useRef(false)

  useEffect(() => {
    if (segundos <= 0) return
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [segundos])

  async function post(url: string, body?: unknown): Promise<{ status: number; data: ApiBody }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = (await res.json().catch(() => ({}))) as ApiBody
    return { status: res.status, data }
  }

  async function pedirCodigo(auto = false) {
    setReenviando(true)
    setErro(undefined)
    try {
      const { status, data } = await post('/api/auth/email/send-code')
      if (data.ok && (data as { alreadyVerified?: boolean }).alreadyVerified) {
        window.location.assign('/bem-vindo')
        return
      }
      if (typeof data.retryAfter === 'number') setSegundos(data.retryAfter)
      if (status === 200) {
        setTravado(false)
        setCode(EMPTY)
        setInfo(auto ? undefined : 'Enviamos um código novo. Confira sua caixa de entrada.')
        refs.current[0]?.focus()
      } else if (!(auto && status === 429)) {
        setInfo(undefined)
        setErro(data.error ?? 'Não foi possível enviar o código agora.')
      }
    } catch {
      setErro('Não foi possível enviar o código agora.')
    } finally {
      setReenviando(false)
    }
  }

  // Chegou aqui sem código vigente (ex.: conta que precisa confirmar o e-mail): pede um automaticamente.
  useEffect(() => {
    if (!configured || hasCode || autoSent.current || initialCooldown > 0) return
    autoSent.current = true
    void pedirCodigo(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function confirmar(c = code) {
    if (enviando) return
    if (!c.every(Boolean)) {
      setErro('Digite os 6 dígitos.')
      return
    }
    setErro(undefined)
    setInfo(undefined)
    setEnviando(true)
    try {
      const { status, data } = await post('/api/auth/email/verify', { code: c.join('') })
      if (data.ok) {
        window.location.assign('/bem-vindo')
        return
      }
      if (data.code === 'locked' || data.code === 'expired') setTravado(true)
      if (status === 401) {
        window.location.assign('/login')
        return
      }
      setErro(data.error ?? 'Não foi possível confirmar agora.')
      if (data.code === 'incorrect') {
        setCode(EMPTY)
        refs.current[0]?.focus()
      }
    } catch {
      setErro('Não foi possível confirmar agora. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  function setDigit(i: number, v: string) {
    const d = v.replace(/\D/g, '')
    const next = code.slice()
    next[i] = d.slice(-1)
    setCode(next)
    setErro(undefined)
    if (d && i < 5) refs.current[i + 1]?.focus()
    if (d && next.every(Boolean)) void confirmar(next)
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'Enter') void confirmar()
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6)
    if (!t) return
    e.preventDefault()
    const next = EMPTY.map((_, j) => t[j] ?? '')
    setCode(next)
    setErro(undefined)
    refs.current[Math.min(t.length, 6) - 1]?.focus()
    if (t.length === 6) void confirmar(next)
  }

  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <IconBadge>
        <EnvelopeSimpleOpen size={24} aria-hidden="true" />
      </IconBadge>
      <AuthTitle
        sub={
          <>
            Enviamos um código de 6 dígitos para <span className="font-medium text-light-text">{email}</span>. Ele vale por 10 minutos.
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
            disabled={!configured || enviando}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`Dígito ${i + 1} de 6`}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'codigo-erro' : undefined}
            className="pc-code-box h-[54px] w-full min-w-0 rounded-md border bg-light-surface text-center text-[22px] font-medium text-light-text transition-[border-color] duration-150"
            style={{
              borderColor: erro ? '#c9806b' : c ? '#7acc4a' : '#e3e7d6',
              background: c ? '#f0faea' : '#ffffff',
            }}
          />
        ))}
      </div>
      {erro && (
        <p id="codigo-erro" role="alert" className="-mt-2.5 text-[11.5px] text-[#a0452f]">
          {erro}
        </p>
      )}
      {info && !erro && (
        <p role="status" className="-mt-2.5 text-[11.5px] text-light-neutral-500">
          {info}
        </p>
      )}
      <button type="button" onClick={() => void confirmar()} disabled={!configured || enviando || travado} className={primaryBtn}>
        {enviando ? <Spinner /> : 'Confirmar'}
      </button>
      <div className="flex justify-between gap-2.5 text-[12.5px]">
        <button
          type="button"
          disabled={!configured || segundos > 0 || reenviando}
          onClick={() => void pedirCodigo()}
          className={!configured || segundos > 0 ? 'text-light-neutral-500' : 'text-light-accent-200'}
        >
          {segundos > 0
            ? `Reenviar código em ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
            : 'Reenviar código'}
        </button>
        <form action={usarOutroEmailAction}>
          <button type="submit" className="text-light-neutral-500 hover:text-light-neutral-300">
            Usar outro e-mail
          </button>
        </form>
      </div>
      {!configured && (
        <div
          role="status"
          className="rounded-md border border-dashed border-light-divider bg-light-surface px-3 py-2.5 text-[11.5px] text-light-neutral-500"
        >
          A confirmação por código está indisponível no momento.{' '}
          <Link href="/" className="text-light-accent-200 underline">
            Continuar para o app
          </Link>
          .
        </div>
      )}
    </div>
  )
}
