'use client'

import { useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { useAppState } from '@/components/app/app-state'
import { api } from './api'
import { Field } from './parts'

type State = { disponivel: boolean; temSenha: boolean; doisFatores: boolean; pendente: { novoEmail: string } | null }
type Mode = 'idle' | 'form' | 'code'

const hint = 'text-[11.5px] text-light-neutral-500'

// Troca do e-mail de login, dentro de "Perfil": senha atual (+ 2FA) e código enviado ao ENDEREÇO NOVO. Só usa os campos,
// botões e avisos que as Configurações já têm (mesmo padrão da seção Segurança). Ao confirmar, todas as sessões caem.
export function TrocaEmail() {
  const { toast } = useAppState()
  const [st, setSt] = useState<State | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code2fa, setCode2fa] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string>()

  const load = () =>
    api<State>('/api/me/email')
      .then(setSt)
      .catch(() => undefined)
  useEffect(() => {
    void load()
  }, [])

  const reset = () => {
    setMode('idle')
    setPassword('')
    setCode2fa('')
    setCode('')
    setErro(undefined)
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    setErro(undefined)
    try {
      return await fn()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Tente novamente em instantes.')
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const post = <T,>(body: unknown) => api<T>('/api/me/email', { method: 'POST', body })

  async function pedir() {
    const r = await run(() => post<{ ok: true }>({ action: 'request', email: email.trim(), password, code2fa: code2fa.trim() || undefined }))
    if (r) {
      setPassword('')
      setCode2fa('')
      setMode('code')
      toast({ title: 'Código enviado', text: 'Confira a caixa de entrada do novo e-mail.' })
      void load()
    }
  }
  async function confirmar() {
    const r = await run(() => post<{ ok: true }>({ action: 'confirm', code: code.trim() }))
    if (r) {
      toast({ title: 'E-mail trocado', text: 'Por segurança, você foi desconectado. Entre de novo com o novo e-mail.' })
      void signOut({ callbackUrl: '/login' })
    }
  }
  async function cancelar() {
    await run(() => post<{ ok: true }>({ action: 'cancel' }))
    reset()
    void load()
  }

  if (!st) return null
  const errorLine = erro && (
    <p role="alert" className="text-[11.5px] text-[#a0452f]">
      {erro}
    </p>
  )

  if (!st.temSenha) {
    return <div className={hint}>O e-mail desta conta é o da sua conta Google. Para trocá-lo, crie uma senha em &quot;Esqueci minha senha&quot; na tela de entrada.</div>
  }
  if (!st.disponivel) {
    return <div className={hint}>A troca de e-mail está indisponível no momento. Tente de novo mais tarde.</div>
  }

  return (
    <div className="flex flex-col gap-3">
      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-2">
          {st.pendente ? (
            <>
              <span className={hint}>Troca aguardando o código enviado para {st.pendente.novoEmail}.</span>
              <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={() => setMode('code')}>
                Digitar código
              </button>
              <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" disabled={busy} onClick={() => void cancelar()}>
                Cancelar pedido
              </button>
            </>
          ) : (
            <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setMode('form')}>
              Trocar e-mail
            </button>
          )}
        </div>
      )}

      {mode === 'form' && (
        <div className="flex flex-col gap-3 rounded-md border border-light-divider px-[14px] py-3">
          <p className={hint}>Pedimos sua senha e enviamos um código para o novo endereço. O e-mail só muda depois de confirmar, e você será desconectado de todos os dispositivos.</p>
          <Field label="Novo e-mail">
            <input className="pc-input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="novo@empresa.com.br" />
          </Field>
          <Field label="Sua senha">
            <input className="pc-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {st.doisFatores && (
            <Field label="Código do aplicativo autenticador">
              <input className="pc-input" inputMode="numeric" autoComplete="one-time-code" maxLength={40} value={code2fa} onChange={(e) => setCode2fa(e.target.value)} placeholder="000000" />
            </Field>
          )}
          {errorLine}
          <div className="flex gap-2">
            <button type="button" className="pc-btn pc-btn-primary" disabled={busy || !email.trim() || !password || (st.doisFatores && !code2fa.trim())} onClick={() => void pedir()}>
              Enviar código
            </button>
            <button type="button" className="pc-btn pc-btn-secondary" disabled={busy} onClick={reset}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mode === 'code' && (
        <div className="flex flex-col gap-3 rounded-md border border-light-divider px-[14px] py-3">
          <p className={hint}>Digite o código de 6 dígitos que enviamos para o novo e-mail. Ele vale por 10 minutos.</p>
          <Field label="Código enviado ao novo e-mail">
            <input
              className="pc-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void confirmar()}
              placeholder="000000"
            />
          </Field>
          {errorLine}
          <div className="flex gap-2">
            <button type="button" className="pc-btn pc-btn-primary" disabled={busy || code.length !== 6} onClick={() => void confirmar()}>
              Confirmar troca
            </button>
            <button type="button" className="pc-btn pc-btn-secondary" disabled={busy} onClick={reset}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
