'use client'

import { useId, useState, type ReactNode } from 'react'
import { Check, Eye, EyeSlash, GoogleLogo } from '@phosphor-icons/react'

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

const STRENGTH_COLORS = ['#e2e6d5', '#d08a6a', '#d9b25b', '#b3ca52', '#86a028']
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
  const border = checked ? '#86a028' : invalid ? '#c9806b' : '#c9cfb8'
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
        style={{ borderColor: border, background: checked ? '#86a028' : 'transparent' }}
      >
        {checked && <Check size={11} weight="bold" color="#f6f7ef" aria-hidden="true" />}
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

// Login social ainda sem provedor configurado: botão visível, desabilitado, com "Em breve".
export function GoogleButton({ label }: { label: string }) {
  return (
    <span title="Em breve" className="block">
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="pc-btn pc-btn-secondary w-full gap-[9px] px-3.5 py-2.5"
      >
        <GoogleLogo size={16} weight="bold" aria-hidden="true" />
        {label}
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
