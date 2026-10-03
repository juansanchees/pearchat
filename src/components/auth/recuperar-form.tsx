'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, PaperPlaneTilt } from '@phosphor-icons/react'
import { AuthTitle, IconBadge } from './auth-shell'
import { EMAIL_RE, Field, Spinner, primaryBtn } from './fields'

export function RecuperarForm() {
  const [email, setEmail] = useState('')
  const [erro, setErro] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [enviado, setEnviado] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    if (!EMAIL_RE.test(email.trim())) {
      setErro('Digite um e-mail válido.')
      return
    }
    setLoading(true)
    setErro(undefined)
    try {
      const res = await fetch('/api/auth/password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (res.status === 429) {
        setErro('Muitas tentativas. Tente de novo em alguns minutos.')
      } else if (!res.ok) {
        setErro('Digite um e-mail válido.')
      } else {
        setEnviado(true)
      }
    } catch {
      setErro('Não foi possível enviar agora. Verifique sua conexão e tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <Link href="/login" className="flex items-center gap-[5px] self-start rounded-sm text-[12.5px] text-light-neutral-500 hover:text-light-neutral-300">
        <ArrowLeft aria-hidden="true" /> Voltar para o login
      </Link>

      {!enviado ? (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <AuthTitle sub="Digite o e-mail da sua conta. Vamos enviar um link para você criar uma senha nova.">
            Recuperar senha
          </AuthTitle>
          <Field id="email" label="E-mail" error={erro}>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setErro(undefined)
              }}
              placeholder="voce@empresa.com.br"
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'email-erro' : undefined}
              className="pc-input"
            />
          </Field>
          <button type="submit" disabled={loading} aria-busy={loading} className={primaryBtn}>
            {loading && <Spinner />}
            Enviar link
          </button>
        </form>
      ) : (
        <div className="flex animate-pcIn flex-col gap-4" role="status">
          <IconBadge>
            <PaperPlaneTilt size={22} weight="fill" aria-hidden="true" />
          </IconBadge>
          <AuthTitle
            size={26}
            sub={
              <>
                Se existir uma conta com <span className="font-medium text-light-text">{email.trim()}</span>, você vai
                receber o link em instantes. Ele vale por 30 minutos.
              </>
            }
          >
            Confira sua caixa de entrada
          </AuthTitle>
          <Link href="/login" className="pc-btn pc-btn-secondary w-full">
            Voltar para o login
          </Link>
        </div>
      )}
    </div>
  )
}
