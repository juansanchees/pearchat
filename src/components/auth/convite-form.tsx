'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { LinkBreak, UsersThree } from '@phosphor-icons/react'
import { aceitarConviteAction } from '@/app/(auth)/convite/[token]/actions'
import { PAPEL_LABEL } from '@/server/auth/permissions'
import type { Papel } from '@/server/auth/permissions'
import { AuthTitle, IconBadge } from './auth-shell'
import { Field, FieldError, GoogleButton, OrDivider, PasswordInput, Spinner, StrengthMeter, primaryBtn } from './fields'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={primaryBtn}>
      {pending && <Spinner />}
      {pending ? 'Entrando…' : 'Aceitar convite'}
    </button>
  )
}

export function ConviteForm({ token, organizacao, papel, googleEnabled }: { token: string; organizacao: string; papel: Papel; googleEnabled: boolean }) {
  const [state, action] = useFormState(aceitarConviteAction.bind(null, token), undefined)
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const server = state?.fieldErrors ?? {}
  const err = (k: string) => (cleared[k] ? undefined : server[k])
  const clear = (k: string) => setCleared((c) => ({ ...c, [k]: true }))

  return (
    <div className="flex animate-pcIn flex-col gap-[18px]">
      <span className="self-start">
        <IconBadge>
          <UsersThree size={24} aria-hidden="true" />
        </IconBadge>
      </span>
      <AuthTitle
        sub={
          <>
            Você foi convidado para a equipe de <strong className="font-medium text-light-text">{organizacao}</strong> como{' '}
            <strong className="font-medium text-light-text">{PAPEL_LABEL[papel].toLowerCase()}</strong>.
          </>
        }
      >
        Entrar na equipe
      </AuthTitle>
      {googleEnabled && (
        <>
          <GoogleButton label="Continuar com Google" enabled />
          <OrDivider />
        </>
      )}
      <form
        action={(fd) => {
          setCleared({})
          action(fd)
        }}
        noValidate
        className="flex flex-col gap-[18px]"
      >
        <div className="flex flex-col gap-[13px]">
          <Field id="nome" label="Seu nome" error={err('nome')}>
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
              aria-invalid={err('nome') ? true : undefined}
              className="pc-input"
            />
          </Field>
          <div>
            <label htmlFor="senha" className="pc-label">
              Crie uma senha
            </label>
            <PasswordInput
              id="senha"
              name="password"
              value={senha}
              onChange={(v) => {
                setSenha(v)
                clear('password')
              }}
              placeholder="Mínimo de 8 caracteres"
              autoComplete="new-password"
              invalid={!!err('password')}
              describedBy={err('password') ? 'senha-erro' : undefined}
            />
            <StrengthMeter value={senha} />
            <FieldError id="senha-erro">{err('password')}</FieldError>
          </div>
        </div>
        {state?.error && (
          <p role="alert" className="-mt-1 text-[12.5px] text-[#a0452f]">
            {state.error}
          </p>
        )}
        <Submit />
        <p className="text-center text-[11.5px] leading-[1.45] text-light-neutral-500">
          Ao continuar, você concorda com os{' '}
          <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-light-accent-200 underline underline-offset-2">
            Termos de uso
          </a>{' '}
          e a{' '}
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-light-accent-200 underline underline-offset-2">
            Política de privacidade
          </a>
          .
        </p>
      </form>
    </div>
  )
}

const MENSAGEM: Record<string, { titulo: string; texto: string }> = {
  expirado: { titulo: 'Convite expirado', texto: 'Este convite passou da validade de 7 dias. Peça um novo convite a quem convidou você.' },
  revogado: { titulo: 'Convite cancelado', texto: 'Este convite foi cancelado. Peça um novo convite a quem convidou você.' },
  usado: { titulo: 'Convite já utilizado', texto: 'Este convite já foi usado. Se a conta é sua, é só entrar com o seu e-mail e senha.' },
  bloqueado: { titulo: 'Muitas tentativas', texto: 'Tente de novo em alguns minutos.' },
  invalido: { titulo: 'Convite não encontrado', texto: 'Confira o link recebido ou peça um novo convite a quem convidou você.' },
}

export function ConviteIndisponivel({ status }: { status: string }) {
  const m = MENSAGEM[status] ?? MENSAGEM.invalido
  return (
    <div className="flex animate-pcIn flex-col gap-5">
      <span className="self-start">
        <IconBadge>
          <LinkBreak size={24} aria-hidden="true" />
        </IconBadge>
      </span>
      <AuthTitle sub={m.texto}>{m.titulo}</AuthTitle>
      <Link href="/login" className="pc-btn pc-btn-secondary w-full px-3.5 py-[11px]">
        Ir para o login
      </Link>
    </div>
  )
}
