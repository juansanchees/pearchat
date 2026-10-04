'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { EnvelopeSimpleOpen } from '@phosphor-icons/react'
import { usarOutroEmailAction } from '@/app/(auth)/verificar-email/actions'
import { AuthTitle, IconBadge } from './auth-shell'
import { CodeBoxes, EMPTY_CODE, type CodeBoxesHandle } from './code-boxes'
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

// Confirmação de e-mail por código de 6 dígitos (POST /api/auth/email/send-code e /verify).
export function VerificarForm({ email, configured, hasCode, initialCooldown }: Props) {
  const [code, setCode] = useState<string[]>(EMPTY_CODE)
  const [erro, setErro] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [segundos, setSegundos] = useState(initialCooldown)
  const [enviando, setEnviando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [travado, setTravado] = useState(false) // código invalidado: precisa pedir outro
  const boxes = useRef<CodeBoxesHandle>(null)
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
        setCode(EMPTY_CODE)
        setInfo(auto ? undefined : 'Enviamos um código novo. Confira sua caixa de entrada.')
        boxes.current?.focus()
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
        setCode(EMPTY_CODE)
        boxes.current?.focus()
      }
    } catch {
      setErro('Não foi possível confirmar agora. Tente de novo.')
    } finally {
      setEnviando(false)
    }
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
      <CodeBoxes
        ref={boxes}
        code={code}
        onChange={(n) => {
          setCode(n)
          setErro(undefined)
        }}
        onComplete={(n) => void confirmar(n)}
        onEnter={() => void confirmar()}
        disabled={!configured || enviando}
        invalid={!!erro}
        describedBy="codigo-erro"
      />
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
