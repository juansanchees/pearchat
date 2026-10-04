'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowSquareOut, Check, Copy, LinkSimple, PencilSimple, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { PearSwitch, Spinner } from '@/components/pear'
import { ANTECEDENCIAS, ANTECEDENCIA_LABEL, DIAS_A_FRENTE } from '@/server/booking/settings'
import type { BookingSettingsDto } from '@/server/booking/settings'
import { validateSlug } from '@/server/booking/slug-rules'
import { api } from './data'

type Patch = Partial<{ ativo: boolean; slug: string; antecedenciaMin: number; diasAFrente: number; mensagem: string | null }>

/** Bloco "Link de agendamento" das Preferências da Agenda: ativar, copiar/abrir, editar o endereço e as regras. */
export function BookingLinkSettings() {
  const { toast } = useAppState()
  const [cfg, setCfg] = useState<BookingSettingsDto | null>(null)
  const [erro, setErro] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editandoSlug, setEditandoSlug] = useState(false)
  const [slugTxt, setSlugTxt] = useState('')
  const [slugErro, setSlugErro] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [copiado, setCopiado] = useState(false)

  const carregar = useCallback(async () => {
    setErro(false)
    try {
      const c = await api<BookingSettingsDto>('/api/booking/settings')
      setCfg(c)
      setMsg(c.mensagem)
    } catch {
      setErro(true)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const salvar = async (patch: Patch): Promise<boolean> => {
    setSaving(true)
    try {
      const c = await api<BookingSettingsDto>('/api/booking/settings', { method: 'PUT', body: patch })
      setCfg(c)
      setMsg(c.mensagem)
      return true
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Tente novamente em instantes.'
      if (patch.slug !== undefined) setSlugErro(m)
      else toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível salvar o link', text: m })
      return false
    } finally {
      setSaving(false)
    }
  }

  const alternar = async (on: boolean) => {
    if (await salvar({ ativo: on })) {
      toast({
        icon: <LinkSimple size={18} weight="fill" />,
        title: on ? 'Link de agendamento ativado' : 'Link de agendamento desativado',
        text: on ? 'Seus clientes já podem agendar sozinhos' : 'O endereço deixa de funcionar até você ativar de novo',
      })
    }
  }

  const copiar = async () => {
    if (!cfg?.url) return
    try {
      await navigator.clipboard.writeText(cfg.url)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1800)
    } catch {
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível copiar', text: 'Selecione o endereço e copie manualmente' })
    }
  }

  const abrirEdicaoSlug = () => {
    setSlugTxt(cfg?.slug ?? cfg?.slugSugerido ?? '')
    setSlugErro(null)
    setEditandoSlug(true)
  }

  const salvarSlug = async () => {
    const v = validateSlug(slugTxt)
    if (!v.ok) {
      setSlugErro(v.message)
      return
    }
    if (v.slug === cfg?.slug) {
      setEditandoSlug(false)
      return
    }
    if (await salvar({ slug: v.slug })) setEditandoSlug(false)
  }

  if (erro) {
    return (
      <div className="flex items-center gap-2 border-0 border-t border-solid border-light-divider pt-2.5 text-[11.5px] text-light-neutral-500">
        Não foi possível carregar o link de agendamento.
        <button type="button" className="pc-btn pc-btn-ghost px-2 py-1 text-[11.5px]" onClick={() => void carregar()}>
          Tentar de novo
        </button>
      </div>
    )
  }
  if (!cfg) {
    return (
      <div className="grid place-items-center border-0 border-t border-solid border-light-divider py-3">
        <Spinner size={14} />
      </div>
    )
  }

  const msgMudou = msg.trim() !== cfg.mensagem

  return (
    <div className="flex flex-col gap-2.5 border-0 border-t border-solid border-light-divider pt-2.5">
      <div className="flex items-center gap-2.5">
        <LinkSimple size={15} className="flex-none text-light-accent-300" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium leading-[1.2]">Link de agendamento</div>
          <div className="mt-[3px] text-[11px] text-light-neutral-500">Seus clientes marcam horário sozinhos</div>
        </div>
        <PearSwitch checked={cfg.ativo} label="Ativar link de agendamento" disabled={saving} onChange={(on) => void alternar(on)} />
      </div>

      {cfg.ativo && cfg.url && (
        <>
          {editandoSlug ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="booking-slug" className="pc-label !mb-0">
                Endereço do link
              </label>
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-none truncate text-[11.5px] text-light-neutral-500" title={cfg.base}>
                  {cfg.base.replace(/^https?:\/\//, '')}
                </span>
                <input
                  id="booking-slug"
                  className="pc-input !min-h-[32px] min-w-0 flex-1 !py-1 !text-[12.5px]"
                  value={slugTxt}
                  maxLength={40}
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!slugErro}
                  aria-describedby="booking-slug-info"
                  onChange={(e) => {
                    setSlugTxt(e.target.value)
                    setSlugErro(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void salvarSlug()
                    if (e.key === 'Escape') setEditandoSlug(false)
                  }}
                />
              </div>
              {slugErro && (
                <p role="alert" className="m-0 text-[11.5px] text-[#a0452f]">
                  {slugErro}
                </p>
              )}
              <p id="booking-slug-info" className="m-0 flex gap-1.5 text-[11px] text-light-neutral-500 [text-wrap:pretty]">
                <Warning size={12} className="mt-px flex-none" />
                Se você trocar o endereço, o link antigo deixa de funcionar. Atualize onde você o divulgou.
              </p>
              <div className="flex gap-2">
                <button type="button" className="pc-btn pc-btn-primary flex-1 px-2.5 py-1.5 text-[12px]" disabled={saving} onClick={() => void salvarSlug()}>
                  {saving ? <Spinner size={12} /> : <Check size={12} />} Salvar endereço
                </button>
                <button type="button" className="pc-btn pc-btn-secondary px-2.5 py-1.5 text-[12px]" disabled={saving} onClick={() => setEditandoSlug(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <input readOnly aria-label="Endereço do link de agendamento" className="pc-input !min-h-[32px] !py-1 !text-[12px]" value={cfg.url} onFocus={(e) => e.currentTarget.select()} />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="pc-btn pc-btn-secondary px-2.5 py-1.5 text-[12px]" onClick={() => void copiar()}>
                  {copiado ? <Check size={12} /> : <Copy size={12} />} {copiado ? 'Copiado' : 'Copiar'}
                </button>
                <a href={cfg.url} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-secondary px-2.5 py-1.5 text-[12px] no-underline">
                  <ArrowSquareOut size={12} /> Abrir
                </a>
                <button type="button" className="pc-btn pc-btn-ghost px-2 py-1.5 text-[12px]" onClick={abrirEdicaoSlug}>
                  <PencilSimple size={12} /> Editar endereço
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="booking-antec" className="pc-label">
                Antecedência mínima
              </label>
              <select
                id="booking-antec"
                className="pc-input !min-h-[32px] !py-1 !text-[12.5px]"
                value={cfg.antecedenciaMin}
                disabled={saving}
                onChange={(e) => void salvar({ antecedenciaMin: Number(e.target.value) })}
              >
                {ANTECEDENCIAS.map((m) => (
                  <option key={m} value={m}>
                    {ANTECEDENCIA_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="booking-dias" className="pc-label">
                Até quantos dias à frente
              </label>
              <select
                id="booking-dias"
                className="pc-input !min-h-[32px] !py-1 !text-[12.5px]"
                value={cfg.diasAFrente}
                disabled={saving}
                onChange={(e) => void salvar({ diasAFrente: Number(e.target.value) })}
              >
                {DIAS_A_FRENTE.map((d) => (
                  <option key={d} value={d}>
                    {d} dias
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="booking-msg" className="pc-label">
                Mensagem de apresentação
              </label>
              <span className="text-[11px] text-light-neutral-500">{msg.length}/200</span>
            </div>
            <textarea
              id="booking-msg"
              className="pc-input !min-h-[60px] !text-[12.5px]"
              value={msg}
              maxLength={200}
              rows={2}
              placeholder="Ex.: Atendemos de segunda a sábado. Chegue 5 minutos antes."
              onChange={(e) => setMsg(e.target.value)}
            />
            {msgMudou && (
              <button type="button" className="pc-btn pc-btn-secondary mt-1.5 px-2.5 py-1.5 text-[12px]" disabled={saving} onClick={() => void salvar({ mensagem: msg.trim() || null })}>
                {saving ? <Spinner size={12} /> : <Check size={12} />} Salvar mensagem
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
