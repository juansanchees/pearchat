'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { EnvelopeSimpleOpen, ShieldCheck } from '@phosphor-icons/react'
import { cancelAccessAction, resendAccessCodeAction, verifyAccessAction } from '@/app/(auth)/verificar-acesso/actions'
import { AuthTitle, IconBadge } from './auth-shell'
import { CodeBoxes, EMPTY_CODE, type CodeBoxesHandle } from './code-boxes'
import { primaryBtn, Spinner } from './fields'

type Props = {
  /** 'totp': código do aplicativo autenticador (ou de recuperação). 'email': código enviado ao e-mail (dispositivo novo). */
  method: 'totp' | 'email'
  /** E-mail mascarado para onde o código foi (modo e-mail). */
  emailMasked?: string
  /** Segundos até poder pedir outro código (modo e-mail). */
  initialCooldown?: number
}

// Segundo passo do login: código do aplicativo autenticador / de recuperação, ou código enviado por e-mail ao entrar
// de um dispositivo que o PearChat ainda não reconhece.
export function AcessoForm({ method, emailMasked, initialCooldown = 0 }: Props) {
  const byEmail = method === 'email'
  const [code, setCode] = useState<string[]>(EMPTY_CODE)
  const [recovery, setRecovery] = useState(false)
  const [rec, setRec] = useState('')
  const [erro, setErro] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [expired, setExpired] = useState(false)
  const [segundos, setSegundos] = useState(initialCooldown)
  const [reenviando, setReenviando] = useState(false)
  const [pending, start] = useTransition()
  const boxes = useRef<CodeBoxesHandle>(null)

  useEffect(() => {
    if (segundos <= 0) return
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [segundos])

  function submit(value: string) {
    if (pending) return
    setErro(undefined)
    setInfo(undefined)
    start(async () => {
      const r = await verifyAccessAction(value)
      if (r?.error) {
        setErro(r.error)
        setExpired(!!r.expired)
        if (!recovery) {
          setCode(EMPTY_CODE)
          boxes.current?.focus()
        }
      }
    })
  }

  function confirm(c = code) {
    if (!c.every(Boolean)) return setErro('Digite os 6 dígitos.')
    submit(c.join(''))
  }

  async function reenviar() {
    if (reenviando || segundos > 0) return
    setReenviando(true)
    setErro(undefined)
    setInfo(undefined)
    try {
      const r = await resendAccessCodeAction()
      if (typeof r.retryAfter === 'number') setSegundos(r.retryAfter)
      if (r.expired) setExpired(true)
      if (r.error) setErro(r.error)
      else {
        setCode(EMPTY_CODE)
        setInfo('Enviamos um código novo. Confira sua caixa de entrada.')
        boxes.current?.focus()
      }
    } catch {
      setErro('Não foi possível enviar o código agora.')
    } finally {
      setReenviando(false)
    }
  }

  const sub = byEmail ? (
    <>
      Este navegador ainda não é reconhecido. Enviamos um código para{' '}
      <span className="font-medium text-light-text">{emailMasked ?? 'o seu e-mail'}</span>. Ele vale por 10 minutos.
    </>
  ) : recovery ? (
    'Digite um dos códigos de recuperação que você guardou. Cada código só funciona uma vez.'
  ) : (
    'Abra o aplicativo autenticador no seu celular e digite o código de 6 dígitos do PearChat.'
  )

  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <IconBadge>{byEmail ? <EnvelopeSimpleOpen size={24} aria-hidden="true" /> : <ShieldCheck size={24} aria-hidden="true" />}</IconBadge>
      <AuthTitle sub={sub}>{byEmail ? 'Confirme que é você' : 'Verificação em duas etapas'}</AuthTitle>

      {recovery && !byEmail ? (
        <div>
          <label htmlFor="rec" className="pc-label">
            Código de recuperação
          </label>
          <input
            id="rec"
            value={rec}
            onChange={(e) => {
              setRec(e.target.value)
              setErro(undefined)
            }}
            onKeyDown={(e) => e.key === 'Enter' && rec.trim() && submit(rec)}
            disabled={pending}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="xxxxx-xxxxx"
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'acesso-erro' : undefined}
            className="pc-input"
          />
        </div>
      ) : (
        <CodeBoxes
          ref={boxes}
          code={code}
          onChange={(n) => {
            setCode(n)
            setErro(undefined)
          }}
          onComplete={(n) => confirm(n)}
          onEnter={() => confirm()}
          disabled={pending}
          invalid={!!erro}
          describedBy="acesso-erro"
        />
      )}

      {erro && (
        <p id="acesso-erro" role="alert" className="-mt-2.5 text-[11.5px] text-[#a0452f]">
          {erro}
        </p>
      )}
      {info && !erro && (
        <p role="status" className="-mt-2.5 text-[11.5px] text-light-neutral-500">
          {info}
        </p>
      )}

      {expired ? (
        <form action={cancelAccessAction}>
          <button type="submit" className={primaryBtn}>
            Voltar para a entrada
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => (recovery && !byEmail ? submit(rec) : confirm())}
          disabled={pending || (recovery && !byEmail && !rec.trim())}
          aria-busy={pending}
          className={primaryBtn}
        >
          {pending ? <Spinner /> : 'Confirmar'}
        </button>
      )}

      <div className="flex justify-between gap-2.5 text-[12.5px]">
        {byEmail ? (
          !expired && (
            <button
              type="button"
              disabled={segundos > 0 || reenviando}
              onClick={() => void reenviar()}
              className={segundos > 0 || reenviando ? 'text-light-neutral-500' : 'text-light-accent-200 hover:text-light-accent-100'}
            >
              {segundos > 0 ? `Reenviar código em ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}` : 'Reenviar código'}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              setRecovery((v) => !v)
              setErro(undefined)
            }}
            className="text-light-accent-200 hover:text-light-accent-100"
          >
            {recovery ? 'Usar o código do aplicativo' : 'Usar um código de recuperação'}
          </button>
        )}
        {!expired && (
          <form action={cancelAccessAction}>
            <button type="submit" className="text-light-neutral-500 hover:text-light-neutral-300">
              Cancelar
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
