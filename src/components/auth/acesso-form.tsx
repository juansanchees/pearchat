'use client'

import { useRef, useState, useTransition } from 'react'
import { ShieldCheck } from '@phosphor-icons/react'
import { cancelAccessAction, verifyAccessAction } from '@/app/(auth)/verificar-acesso/actions'
import { AuthTitle, IconBadge } from './auth-shell'
import { CodeBoxes, EMPTY_CODE, type CodeBoxesHandle } from './code-boxes'
import { primaryBtn, Spinner } from './fields'

// Segundo fator do login: código do aplicativo autenticador (6 dígitos) ou código de recuperação.
export function AcessoForm() {
  const [code, setCode] = useState<string[]>(EMPTY_CODE)
  const [recovery, setRecovery] = useState(false)
  const [rec, setRec] = useState('')
  const [erro, setErro] = useState<string>()
  const [expired, setExpired] = useState(false)
  const [pending, start] = useTransition()
  const boxes = useRef<CodeBoxesHandle>(null)

  function submit(value: string) {
    if (pending) return
    setErro(undefined)
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

  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <IconBadge>
        <ShieldCheck size={24} aria-hidden="true" />
      </IconBadge>
      <AuthTitle
        sub={
          recovery
            ? 'Digite um dos códigos de recuperação que você guardou. Cada código só funciona uma vez.'
            : 'Abra o aplicativo autenticador no seu celular e digite o código de 6 dígitos do PearChat.'
        }
      >
        Verificação em duas etapas
      </AuthTitle>

      {recovery ? (
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

      {expired ? (
        <form action={cancelAccessAction}>
          <button type="submit" className={primaryBtn}>
            Voltar para a entrada
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => (recovery ? submit(rec) : confirm())} disabled={pending || (recovery && !rec.trim())} aria-busy={pending} className={primaryBtn}>
          {pending ? <Spinner /> : 'Confirmar'}
        </button>
      )}

      <div className="flex justify-between gap-2.5 text-[12.5px]">
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
