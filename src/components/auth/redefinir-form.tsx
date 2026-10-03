'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CheckCircle, LinkBreak } from '@phosphor-icons/react'
import { AuthTitle, IconBadge } from './auth-shell'
import { FieldError, PasswordInput, Spinner, StrengthMeter, primaryBtn } from './fields'

export function RedefinirForm({ token }: { token?: string }) {
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [errs, setErrs] = useState<{ senha?: string; confirma?: string }>({})
  const [erroGeral, setErroGeral] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [estado, setEstado] = useState<'form' | 'ok' | 'invalido'>(token ? 'form' : 'invalido')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading || !token) return
    const next: typeof errs = {}
    if (senha.length < 8) next.senha = 'Use pelo menos 8 caracteres.'
    if (confirma !== senha) next.confirma = 'As senhas não são iguais.'
    setErrs(next)
    setErroGeral(undefined)
    if (next.senha || next.confirma) return
    setLoading(true)
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: senha }),
      })
      if (res.ok) setEstado('ok')
      else if (res.status === 429) setErroGeral('Muitas tentativas. Tente de novo em alguns minutos.')
      else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        if (body?.error?.startsWith('A senha')) setErrs({ senha: 'Use pelo menos 8 caracteres.' })
        else setEstado('invalido')
      }
    } catch {
      setErroGeral('Não foi possível salvar agora. Verifique sua conexão e tente de novo.')
    } finally {
      setLoading(false)
    }
  }

  if (estado === 'ok') {
    return (
      <div className="flex animate-pcIn flex-col gap-4" role="status">
        <IconBadge>
          <CheckCircle size={24} weight="fill" aria-hidden="true" />
        </IconBadge>
        <AuthTitle size={26} sub="Sua senha foi atualizada. Entre com a senha nova.">
          Senha alterada
        </AuthTitle>
        <Link href="/login" className={primaryBtn}>
          Ir para o login
        </Link>
      </div>
    )
  }

  if (estado === 'invalido') {
    return (
      <div className="flex animate-pcIn flex-col gap-4" role="alert">
        <IconBadge>
          <LinkBreak size={24} aria-hidden="true" />
        </IconBadge>
        <AuthTitle size={26} sub="Este link é inválido ou expirou. Os links valem por 30 minutos e funcionam uma única vez.">
          Link indisponível
        </AuthTitle>
        <Link href="/recuperar-senha" className={primaryBtn}>
          Pedir um link novo
        </Link>
        <Link href="/login" className="pc-btn pc-btn-secondary w-full">
          Voltar para o login
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex animate-pcIn flex-col gap-5">
      <AuthTitle sub="Escolha uma senha nova para a sua conta.">Criar senha nova</AuthTitle>
      <div className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="senha" className="pc-label">
            Senha nova
          </label>
          <PasswordInput
            id="senha"
            name="password"
            value={senha}
            onChange={(v) => {
              setSenha(v)
              setErrs((e) => ({ ...e, senha: undefined }))
            }}
            placeholder="Mínimo de 8 caracteres"
            autoComplete="new-password"
            invalid={!!errs.senha}
            describedBy={errs.senha ? 'senha-erro' : undefined}
          />
          <StrengthMeter value={senha} />
          <FieldError id="senha-erro">{errs.senha}</FieldError>
        </div>
        <div>
          <label htmlFor="confirma" className="pc-label">
            Repita a senha
          </label>
          <PasswordInput
            id="confirma"
            name="confirm"
            value={confirma}
            onChange={(v) => {
              setConfirma(v)
              setErrs((e) => ({ ...e, confirma: undefined }))
            }}
            placeholder="Digite a senha de novo"
            autoComplete="new-password"
            invalid={!!errs.confirma}
            describedBy={errs.confirma ? 'confirma-erro' : undefined}
          />
          <FieldError id="confirma-erro">{errs.confirma}</FieldError>
        </div>
      </div>
      {erroGeral && (
        <p role="alert" className="-mt-2 text-[12.5px] text-[#a0452f]">
          {erroGeral}
        </p>
      )}
      <button type="submit" disabled={loading} aria-busy={loading} className={primaryBtn}>
        {loading && <Spinner />}
        Salvar senha nova
      </button>
    </form>
  )
}
