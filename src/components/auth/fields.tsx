'use client'

import { useId, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Roboto } from 'next/font/google'
import { Check, Eye, EyeSlash } from '@phosphor-icons/react'
import { googleAction } from '@/app/(auth)/_lib/google-action'
import { GoogleG } from '@/components/brand/google-g'

// Botão do Google conforme as diretrizes de marca (tema claro): fundo #FFFFFF, traço #747775 de 1 px,
// texto #1F1F1F em Roboto Medium 14/20, "G" colorido de 20 px com 12 px de margem à esquerda e 10 px até o texto.
const roboto = Roboto({ weight: '500', subsets: ['latin'], display: 'swap' })
const googleBtnCls =
  'pc-btn w-full gap-[10px] border-[#747775] bg-white px-3 py-[9px] text-[14px] font-medium leading-5 text-[#1F1F1F] hover:bg-[#f2f2f2]'

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[15px] w-[15px] animate-pcSpin rounded-full border-2 border-light-accent-700 border-t-light-accent-300 ${className}`}
    />
  )
}

export function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-[5px] text-[11.5px] text-[#a0452f]">
      {children}
    </p>
  )
}

export function Field({
  id,
  label,
  error,
  labelRight,
  children,
}: {
  id: string
  label: string
  error?: string
  labelRight?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="pc-label">
          {label}
        </label>
        {labelRight}
      </div>
      {children}
      <FieldError id={`${id}-erro`}>{error}</FieldError>
    </div>
  )
}

export function PasswordInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string
  name: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete: string
  invalid?: boolean
  describedBy?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="pc-input pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={show}
        title={show ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-1.5 top-1/2 grid h-[30px] w-[30px] -translate-y-1/2 place-items-center rounded-md text-light-neutral-500 hover:text-light-neutral-300"
      >
        {show ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}

const STRENGTH_COLORS = ['#e2e6d5', '#d08a6a', '#d9b25b', '#7acc4a', '#2e9a48']
const STRENGTH_LABELS = ['', 'Fraca', 'Média', 'Boa', 'Forte']

export function passwordStrength(p: string): number {
  let n = 0
  if (p.length >= 8) n++
  if (/[A-Z]/.test(p)) n++
  if (/\d/.test(p)) n++
  if (/[^A-Za-z0-9]/.test(p)) n++
  return p ? Math.max(1, n) : 0
}

export function StrengthMeter({ value }: { value: string }) {
  const score = passwordStrength(value)
  return (
    <div className="mt-[7px] flex items-center gap-2.5">
      <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1 rounded-full transition-[background] duration-200"
            style={{ background: i <= score ? STRENGTH_COLORS[score] : STRENGTH_COLORS[0] }}
          />
        ))}
      </div>
      <span className="w-11 text-right text-[11px] text-light-neutral-500" aria-live="polite" aria-label={score ? `Força da senha: ${STRENGTH_LABELS[score]}` : undefined}>
        {STRENGTH_LABELS[score]}
      </span>
    </div>
  )
}

export function CheckboxRow({
  checked,
  onChange,
  invalid,
  describedBy,
  children,
  align = 'center',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  invalid?: boolean
  describedBy?: string
  children: ReactNode
  align?: 'center' | 'start'
}) {
  const border = checked ? '#2e9a48' : invalid ? '#c9806b' : '#c9cfb8'
  const labelId = useId()
  // O texto fica fora do <button> para poder conter links (Termos/Privacidade) sem aninhar controles.
  return (
    <div className={`flex gap-[9px] text-[12.5px] text-light-neutral-400 ${align === 'start' ? 'items-start leading-[1.45]' : 'items-center self-start'}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={`grid h-[17px] w-[17px] flex-none place-items-center rounded-[5px] border ${align === 'start' ? 'mt-px' : ''}`}
        style={{ borderColor: border, background: checked ? '#2e9a48' : 'transparent' }}
      >
        {checked && <Check size={11} weight="bold" color="#ffffff" aria-hidden="true" />}
      </button>
      <span
        id={labelId}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a')) onChange(!checked)
        }}
        className="cursor-pointer"
      >
        {children}
      </span>
    </div>
  )
}

function GoogleSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={googleBtnCls}
    >
      {pending ? <Spinner /> : <GoogleG size={20} />}
      <span className={roboto.className}>{pending ? 'Abrindo o Google…' : label}</span>
    </button>
  )
}

// "Continuar com o Google": ativo quando o servidor tem credenciais do Google; senão fica desabilitado com "Em breve".
export function GoogleButton({ label, enabled = false, callbackUrl }: { label: string; enabled?: boolean; callbackUrl?: string }) {
  if (enabled) {
    return (
      <form action={googleAction} className="flex flex-col gap-2">
        {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
        <GoogleSubmit label={label} />
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
    )
  }
  return (
    <span title="Em breve" className="block">
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={googleBtnCls}
      >
        <GoogleG size={20} />
        <span className={roboto.className}>{label}</span>
        <span className="rounded-full border border-light-divider bg-light-neutral-900 px-2 py-0.5 text-[10px] text-light-neutral-500">
          Em breve
        </span>
      </button>
    </span>
  )
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-light-neutral-500" role="separator">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-light-divider" />
      ou com e-mail
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-light-divider" />
    </div>
  )
}

export const primaryBtn =
  'pc-btn pc-btn-primary w-full !border-light-accent-400 !text-light-accent-200 px-3.5 py-[11px]'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
