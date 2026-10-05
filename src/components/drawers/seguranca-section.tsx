'use client'

import { useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { Check, Copy, DownloadSimple, ShieldCheck, SignOut } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { api } from './api'
import { Section } from './parts'

type State = { enabled: boolean; hasPassword: boolean; recoveryLeft: number }
type Setup = { secret: string; qr: string }
type Mode = 'idle' | 'askpwd' | 'setup' | 'codes' | 'disable' | 'regen'

const box = 'flex flex-col gap-3 rounded-md border border-light-divider px-[14px] py-3'
const hint = 'text-[11.5px] text-light-neutral-500'

// Seção "Segurança" das Configurações: verificação em duas etapas (TOTP) e "sair de todos os dispositivos".
export function SegurancaSection() {
  const { toast } = useAppState()
  const [st, setSt] = useState<State | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string>()
  const [confirmAll, setConfirmAll] = useState(false)

  const load = () =>
    api<State>('/api/security/2fa')
      .then(setSt)
      .catch(() => undefined)
  useEffect(() => {
    void load()
  }, [])

  const reset = () => {
    setMode('idle')
    setSetup(null)
    setCode('')
    setPassword('')
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

  const post = <T,>(body: unknown) => api<T>('/api/security/2fa', { method: 'POST', body })

  async function start() {
    const r = await run(() => post<Setup>({ action: 'setup', password: password || undefined }))
    if (r) {
      setPassword('')
      setSetup(r)
      setMode('setup')
    }
  }
  async function enable() {
    const r = await run(() => post<{ recoveryCodes: string[] }>({ action: 'enable', code }))
    if (r) {
      setCodes(r.recoveryCodes)
      setSaved(false)
      setSetup(null)
      setCode('')
      setMode('codes')
      void load()
    }
  }
  async function regen() {
    const r = await run(() => post<{ recoveryCodes: string[] }>({ action: 'recovery', code }))
    if (r) {
      setCodes(r.recoveryCodes)
      setSaved(false)
      setCode('')
      setMode('codes')
      void load()
    }
  }
  async function disable() {
    const r = await run(() => post<{ ok: true }>({ action: 'disable', code, password: password || undefined }))
    if (r) {
      toast({ title: 'Verificação em duas etapas desativada', text: 'Você será desconectado de todos os dispositivos.' })
      void signOut({ callbackUrl: '/login' })
    }
  }
  async function logoutAll() {
    const r = await run(() => api<{ ok: true }>('/api/security/sessions', { method: 'DELETE' }))
    if (r) void signOut({ callbackUrl: '/login' })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      toast({ title: 'Códigos copiados' })
    } catch {
      toast({ title: 'Não foi possível copiar', text: 'Selecione os códigos e copie manualmente.' })
    }
  }
  const download = () => {
    const blob = new Blob([`Códigos de recuperação do PearChat\nCada código funciona uma vez.\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pearchat-codigos-de-recuperacao.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const codeInput = (label: string, onEnter: () => void) => (
    <div>
      <label htmlFor="seg-code" className="pc-label">
        {label}
      </label>
      <input
        id="seg-code"
        className="pc-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && code.trim() && onEnter()}
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        placeholder="000000"
        maxLength={40}
      />
    </div>
  )
  const errorLine = erro && (
    <p role="alert" className="text-[11.5px] text-[#a0452f]">
      {erro}
    </p>
  )

  return (
    <Section label="Segurança" gap="gap-3">
      <div className={box}>
        <div className="flex items-center gap-3">
          <ShieldCheck size={18} className="flex-none text-light-accent-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-[1.25]">Verificação em duas etapas</div>
            <div className={hint}>Além da senha, pede um código do aplicativo autenticador ao entrar.</div>
          </div>
          {st && (
            <span className={`rounded-pill border px-2.5 py-1 text-[11px] ${st.enabled ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200' : 'border-light-divider text-light-neutral-400'}`}>
              {st.enabled ? 'Ativa' : 'Desativada'}
            </span>
          )}
        </div>

        {mode === 'idle' && st && !st.enabled && (
          <div className="flex flex-col gap-2">
            <button type="button" className="pc-btn pc-btn-primary self-start" onClick={() => (st.hasPassword ? setMode('askpwd') : void start())} disabled={busy}>
              Ativar verificação em duas etapas
            </button>
            {errorLine}
          </div>
        )}

        {mode === 'askpwd' && (
          <div className="flex flex-col gap-3">
            <p className={hint}>Por segurança, confirme sua senha para ativar a verificação em duas etapas.</p>
            <div>
              <label htmlFor="seg-pwd-setup" className="pc-label">
                Senha
              </label>
              <input
                id="seg-pwd-setup"
                type="password"
                className="pc-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && password && void start()}
                autoComplete="current-password"
              />
            </div>
            {errorLine}
            <div className="flex gap-2">
              <button type="button" className="pc-btn pc-btn-primary" onClick={() => void start()} disabled={busy || !password}>
                Continuar
              </button>
              <button type="button" className="pc-btn pc-btn-secondary" onClick={reset} disabled={busy}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {mode === 'idle' && st?.enabled && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={() => { reset(); setMode('regen') }}>
              Gerar novos códigos de recuperação
            </button>
            <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => { reset(); setMode('disable') }}>
              Desativar
            </button>
            <span className={hint}>{st.recoveryLeft} de 10 códigos de recuperação disponíveis</span>
          </div>
        )}

        {mode === 'setup' && setup && (
          <div className="flex flex-col gap-3">
            <p className="text-[12.5px] leading-[1.5] text-light-neutral-300">
              1. No aplicativo autenticador (Google Authenticator, Authy, 1Password…), escaneie o QR ou digite a chave.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR do aplicativo autenticador" width={160} height={160} className="rounded-md border border-light-divider" />
              <div className="min-w-0">
                <div className={hint}>Chave para digitar manualmente</div>
                <code className="mt-1 block break-all rounded-md bg-light-bg px-2 py-1.5 text-[12.5px] tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
              </div>
            </div>
            <p className="text-[12.5px] text-light-neutral-300">2. Digite o código de 6 dígitos que o aplicativo mostra.</p>
            {codeInput('Código', () => void enable())}
            {errorLine}
            <div className="flex gap-2">
              <button type="button" className="pc-btn pc-btn-primary" onClick={() => void enable()} disabled={busy || code.trim().length < 6}>
                Confirmar e ativar
              </button>
              <button type="button" className="pc-btn pc-btn-secondary" onClick={reset} disabled={busy}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {mode === 'codes' && (
          <div className="flex flex-col gap-3">
            <p className="text-[12.5px] leading-[1.5] text-light-neutral-300">
              Guarde estes códigos de recuperação em um lugar seguro. Cada um funciona <strong>uma vez</strong> se você perder o celular. Eles não serão mostrados de novo.
            </p>
            <ul className="m-0 grid list-none grid-cols-2 gap-1.5 rounded-md bg-light-bg p-3 font-mono text-[13px]" aria-label="Códigos de recuperação">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={() => void copy()}>
                <Copy size={14} aria-hidden="true" /> Copiar
              </button>
              <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={download}>
                <DownloadSimple size={14} aria-hidden="true" /> Baixar .txt
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              Já guardei os códigos em um lugar seguro
            </label>
            <button type="button" className="pc-btn pc-btn-primary self-start" disabled={!saved} onClick={() => { setCodes([]); reset() }}>
              <Check size={14} aria-hidden="true" /> Concluir
            </button>
          </div>
        )}

        {mode === 'regen' && (
          <div className="flex flex-col gap-3">
            <p className={hint}>Os códigos atuais deixam de valer. Digite um código do aplicativo para continuar.</p>
            {codeInput('Código do aplicativo ou de recuperação', () => void regen())}
            {errorLine}
            <div className="flex gap-2">
              <button type="button" className="pc-btn pc-btn-primary" onClick={() => void regen()} disabled={busy || !code.trim()}>
                Gerar novos códigos
              </button>
              <button type="button" className="pc-btn pc-btn-secondary" onClick={reset} disabled={busy}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {mode === 'disable' && st && (
          <div className="flex flex-col gap-3">
            <p className={hint}>Ao desativar, os códigos de recuperação são apagados e todos os dispositivos são desconectados.</p>
            {st.hasPassword && (
              <div>
                <label htmlFor="seg-pwd" className="pc-label">
                  Senha
                </label>
                <input id="seg-pwd" type="password" className="pc-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
            )}
            {codeInput('Código do aplicativo ou de recuperação', () => void disable())}
            {errorLine}
            <div className="flex gap-2">
              <button type="button" className="pc-btn pc-btn-primary" onClick={() => void disable()} disabled={busy || !code.trim() || (st.hasPassword && !password)}>
                Desativar
              </button>
              <button type="button" className="pc-btn pc-btn-secondary" onClick={reset} disabled={busy}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={box}>
        <div className="flex items-center gap-3">
          <SignOut size={18} className="flex-none text-light-accent-300" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-[1.25]">Sessões</div>
            <div className={hint}>Desconecta este e todos os outros dispositivos onde você está logado.</div>
          </div>
          {!confirmAll ? (
            <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={() => setConfirmAll(true)}>
              Sair de todos os dispositivos
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button type="button" className="pc-btn pc-btn-primary !text-[12px]" onClick={() => void logoutAll()} disabled={busy}>
                Confirmar
              </button>
              <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setConfirmAll(false)} disabled={busy}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
