'use client'

import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { CloudArrowUp, X } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { maskPhoneInput, phoneInputError } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { TAG_OPTIONS } from './types'
import type { NewContactInput } from './types'

export function NewContactCard({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  /** Retorna true quando salvou (o cartão fecha). Valida nome e mostra os toasts. */
  onSubmit: (input: NewContactInput) => Promise<boolean>
}) {
  const uid = useId()
  const { locale } = useAppState()
  const ddiPadrao = locale.ddiPadrao
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [tag, setTag] = useState<string>('Lead')
  const [customTag, setCustomTag] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    // Telefone preenchido porém inválido para o DDI padrão do espaço: avisa no campo (vazio é tratado por quem recebe).
    if (phone.trim() && phoneInputError(phone, ddiPadrao)) {
      setPhoneTouched(true)
      return
    }
    setSaving(true)
    try {
      const ok = await onSubmit({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        tags: [customTag.trim() || tag],
      })
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label="Novo contato"
      className="flex flex-none animate-zfIn flex-col gap-[11px] rounded-lg border border-solid border-light-accent-600 bg-light-surface p-[18px] shadow-md"
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-sm font-medium leading-tight">Novo contato</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="pc-btn pc-btn-ghost !h-7 !w-7 !p-0"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor={`${uid}-nome`} className="pc-label">
          Nome
        </label>
        <input
          id={`${uid}-nome`}
          className="pc-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome completo"
          autoComplete="off"
          autoFocus
        />
      </div>
      <div>
        <label htmlFor={`${uid}-tel`} className="pc-label">
          WhatsApp <span aria-hidden="true">*</span>
        </label>
        <input
          id={`${uid}-tel`}
          className="pc-input"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(maskPhoneInput(e.target.value, ddiPadrao))}
          onBlur={() => setPhoneTouched(true)}
          aria-invalid={phoneTouched && phone.trim() !== '' && phoneInputError(phone, ddiPadrao) !== null}
          placeholder={ddiPadrao === '55' ? '(11) 90000-0000 ou +DDI número' : `Número local ou +${ddiPadrao} …`}
          autoComplete="off"
          required
          aria-required="true"
        />
        {phoneTouched && phone.trim() !== '' && phoneInputError(phone, ddiPadrao) ? (
          <p role="alert" className="mt-1 text-[11.5px] text-red-600">
            {phoneInputError(phone, ddiPadrao)}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor={`${uid}-email`} className="pc-label">
          E-mail
        </label>
        <input
          id={`${uid}-email`}
          className="pc-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="opcional"
          autoComplete="off"
        />
      </div>
      <div role="group" aria-labelledby={`${uid}-tag`}>
        <span id={`${uid}-tag`} className="pc-label">
          Etiqueta
        </span>
        <div className="flex flex-wrap gap-1.5">
          {TAG_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTag(t)}
              aria-pressed={tag === t}
              className={cn(
                'rounded-pill border border-solid px-[11px] py-[5px] text-xs',
                tag === t
                  ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
                  : 'border-light-divider bg-transparent text-light-neutral-400 hover:border-light-neutral-700',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          className="pc-input mt-2"
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          placeholder="+ etiqueta (opcional)"
          maxLength={30}
          aria-label="Nova etiqueta"
          autoComplete="off"
        />
      </div>

      <button type="submit" disabled={saving} className="pc-btn pc-btn-primary w-full">
        <CloudArrowUp size={16} aria-hidden="true" />
        {saving ? 'Salvando…' : 'Salvar na nuvem'}
      </button>
    </form>
  )
}
