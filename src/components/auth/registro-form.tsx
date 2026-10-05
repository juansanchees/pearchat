'use client'

import { useState, type FormEvent } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { registroAction } from '@/app/(auth)/registro/actions'
import { AuthTitle } from './auth-shell'
import {
  CheckboxRow,
  EMAIL_RE,
  Field,
  FieldError,
  GoogleButton,
  OrDivider,
  PasswordInput,
  Spinner,
  StrengthMeter,
  primaryBtn,
} from './fields'

function fmtTel(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={primaryBtn}>
      {pending && <Spinner />}
      {pending ? 'Criando conta…' : 'Criar conta'}
    </button>
  )
}

type Key = 'nome' | 'email' | 'tel' | 'senha' | 'termos'
type Errs = Partial<Record<Key, string>>
const SERVER_KEY: Record<Key, string> = { nome: 'nome', email: 'email', tel: 'tel', senha: 'password', termos: 'termos' }

export function RegistroForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const [state, action] = useFormState(registroAction, undefined)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [tel, setTel] = useState('')
  const [senha, setSenha] = useState('')
  const [termos, setTermos] = useState(false)
  const [errs, setErrs] = useState<Errs>({})
  // Erros devolvidos pelo servidor valem até o campo ser editado de novo.
  const [cleared, setCleared] = useState<Partial<Record<Key, boolean>>>({})
  const clear = (k: Key) => {
    setErrs((e) => ({ ...e, [k]: undefined }))
    setCleared((c) => ({ ...c, [k]: true }))
  }

  const server = state?.fieldErrors ?? {}
  const err = (k: Key) => errs[k] ?? (cleared[k] ? undefined : server[SERVER_KEY[k]])
  const eNome = err('nome')
  const eEmail = err('email')
  const eTel = err('tel')
  const eSenha = err('senha')
  const eTermos = err('termos')

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const next: Errs = {}
    if (nome.trim().length < 2) next.nome = 'Digite seu nome.'
    if (!EMAIL_RE.test(email.trim())) next.email = 'Digite um e-mail válido.'
    if (tel.replace(/\D/g, '').length < 10) next.tel = 'Digite o número com DDD.'
    if (senha.length < 8) next.senha = 'Use pelo menos 8 caracteres.'
    if (!termos) next.termos = 'Aceite os termos para continuar.'
    setErrs(next)
    if (Object.keys(next).length) {
      e.preventDefault()
      return
    }
    setCleared({})
  }

  return (
    <div className="flex animate-pcIn flex-col gap-[18px]">
      <AuthTitle
        sub={
          <span className="flex flex-wrap items-center gap-[7px]">
            Teste o plano Pro por 7 dias.
            <span className="rounded-full border border-light-accent-700 bg-light-accent-900 px-2 py-0.5 text-[10.5px] font-medium text-light-accent-200">
              Sem cartão
            </span>
          </span>
        }
      >
        Criar conta
      </AuthTitle>
      <GoogleButton label="Cadastrar-se com o Google" enabled={googleEnabled} />
      <OrDivider />
      <form action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-[13px]">
        <Field id="nome" label="Seu nome" error={eNome}>
          <input
            id="nome"
            name="nome"
            autoComplete="name"
            value={nome}
            onChange={(e) => {
              setNome(e.target.value)
              clear('nome')
            }}
            placeholder="Como você quer ser chamado"
            aria-invalid={eNome ? true : undefined}
            aria-describedby={eNome ? 'nome-erro' : undefined}
            className="pc-input"
          />
        </Field>
        <Field id="email" label="E-mail" error={eEmail}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              clear('email')
            }}
            placeholder="voce@empresa.com.br"
            aria-invalid={eEmail ? true : undefined}
            aria-describedby={eEmail ? 'email-erro' : undefined}
            className="pc-input"
          />
        </Field>
        <Field id="tel" label="WhatsApp" error={eTel}>
          <input
            id="tel"
            name="telefone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={tel}
            onChange={(e) => {
              setTel(fmtTel(e.target.value))
              clear('tel')
            }}
            placeholder="(11) 90000-0000"
            aria-invalid={eTel ? true : undefined}
            aria-describedby={eTel ? 'tel-erro' : undefined}
            className="pc-input"
          />
        </Field>
        <div>
          <label htmlFor="senha" className="pc-label">
            Senha
          </label>
          <PasswordInput
            id="senha"
            name="password"
            value={senha}
            onChange={(v) => {
              setSenha(v)
              clear('senha')
            }}
            placeholder="Mínimo de 8 caracteres"
            autoComplete="new-password"
            invalid={!!eSenha}
            describedBy={eSenha ? 'senha-erro' : undefined}
          />
          <StrengthMeter value={senha} />
          <FieldError id="senha-erro">{eSenha}</FieldError>
        </div>
        <input type="hidden" name="termos" value={termos ? 'true' : 'false'} />
        <CheckboxRow
          checked={termos}
          onChange={(v) => {
            setTermos(v)
            clear('termos')
          }}
          invalid={!!eTermos}
          describedBy={eTermos ? 'termos-erro' : undefined}
          align="start"
        >
          Li e aceito os <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-light-accent-200 underline underline-offset-2">Termos de uso</a> e a{' '}
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-light-accent-200 underline underline-offset-2">Política de privacidade</a>.
        </CheckboxRow>
        {eTermos && (
          <p id="termos-erro" role="alert" className="-mt-1.5 text-[11.5px] text-[#a0452f]">
            {eTermos}
          </p>
        )}
      </div>
      {state?.error && (
        <p role="alert" className="-mt-1 text-[12.5px] text-[#a0452f]">
          {state.error}
        </p>
      )}
      <Submit />
      </form>
    </div>
  )
}
