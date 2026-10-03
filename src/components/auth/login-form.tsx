'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { loginAction } from '@/app/(auth)/login/actions'
import { AuthTitle } from './auth-shell'
import { CheckboxRow, EMAIL_RE, Field, GoogleButton, OrDivider, PasswordInput, Spinner, primaryBtn } from './fields'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={primaryBtn}>
      {pending && <Spinner />}
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  )
}

export function LoginForm({
  googleEnabled = false,
  oauthError,
  callbackUrl = '/',
}: {
  googleEnabled?: boolean
  oauthError?: string
  callbackUrl?: string
}) {
  const [state, action] = useFormState(loginAction, undefined)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [lembrar, setLembrar] = useState(true)
  const [errs, setErrs] = useState<{ email?: string; senha?: string }>({})
  // O erro do servidor some assim que a pessoa edita algum campo.
  const [edited, setEdited] = useState(false)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const next: typeof errs = {}
    if (!EMAIL_RE.test(email.trim())) next.email = 'Digite um e-mail válido.'
    if (senha.length < 6) next.senha = 'A senha precisa ter pelo menos 6 caracteres.'
    setErrs(next)
    if (next.email || next.senha) {
      e.preventDefault()
      return
    }
    setEdited(false)
  }

  const serverError = !edited ? state?.error : undefined

  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <AuthTitle sub="Que bom ter você de volta.">Entrar</AuthTitle>
      {oauthError && (
        <p role="alert" className="text-[12.5px] text-[#a0452f]">
          {oauthError}
        </p>
      )}
      <GoogleButton label="Continuar com Google" enabled={googleEnabled} callbackUrl={callbackUrl} />
      <OrDivider />
      <form action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-3.5">
        <Field id="email" label="E-mail" error={errs.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErrs((v) => ({ ...v, email: undefined }))
              setEdited(true)
            }}
            placeholder="voce@empresa.com.br"
            aria-invalid={errs.email || serverError ? true : undefined}
            aria-describedby={errs.email ? 'email-erro' : undefined}
            className="pc-input"
          />
        </Field>
        <Field
          id="senha"
          label="Senha"
          error={errs.senha}
          labelRight={
            <Link href="/recuperar-senha" className="rounded-sm text-xs text-light-accent-200 hover:text-light-accent-100">
              Esqueci minha senha
            </Link>
          }
        >
          <PasswordInput
            id="senha"
            name="password"
            value={senha}
            onChange={(v) => {
              setSenha(v)
              setErrs((e) => ({ ...e, senha: undefined }))
              setEdited(true)
            }}
            placeholder="Sua senha"
            autoComplete="current-password"
            invalid={!!errs.senha || !!serverError}
            describedBy={errs.senha ? 'senha-erro' : undefined}
          />
        </Field>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <input type="hidden" name="lembrar" value={lembrar ? 'true' : 'false'} />
        <CheckboxRow checked={lembrar} onChange={setLembrar}>
          Manter conectado neste computador
        </CheckboxRow>
      </div>
      {serverError && (
        <p id="login-erro" role="alert" className="-mt-2 text-[12.5px] text-[#a0452f]">
          {serverError}
        </p>
      )}
      <Submit />
      </form>
    </div>
  )
}
