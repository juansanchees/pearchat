'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AppleLogo,
  ArrowLeft,
  ArrowRight,
  BellRinging,
  CalendarCheck,
  Check,
  CheckCircle,
  GoogleLogo,
  MicrosoftOutlookLogo,
  Sparkle,
  UserPlus,
  Warning,
  WhatsappLogo,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { Spinner, Tag } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { CalendarStateDto } from '@/server/calendar/types'
import { CAL_CORES, DEMO_CALS, DEMO_DESTINO, DEMO_SELECIONADAS, GOOGLE_CONTAS, api } from './data'

export type ConnectStep = null | 'conta' | 'agendas'

const BENEFICIOS: { icon: Icon; titulo: string; texto: string }[] = [
  { icon: WhatsappLogo, titulo: 'Agendou no WhatsApp, caiu no Google', texto: 'Cada horário marcado numa conversa vira um evento no seu calendário.' },
  { icon: Sparkle, titulo: 'A IA só oferece horários livres', texto: 'O agente consulta sua agenda antes de sugerir um horário ao cliente.' },
  { icon: BellRinging, titulo: 'Lembrete automático para o cliente', texto: 'Mensagem no WhatsApp antes do compromisso, sem você precisar lembrar.' },
]

const OUTRAS: { nome: string; icon: Icon }[] = [
  { nome: 'Outlook', icon: MicrosoftOutlookLogo },
  { nome: 'Apple iCloud', icon: AppleLogo },
]

const CONNECTING_MS = 1200
const cardCls = 'flex animate-zfIn flex-col rounded-md bg-light-surface shadow-md'

/**
 * Fluxo de conexão em 3 passos (intro -> conta -> agendas).
 * `realMode`: voltou do OAuth real (?passo=agendas); a conexão já existe e as agendas vêm de `cal`.
 */
export function ConnectFlow({
  cal,
  step,
  onStep,
  realMode,
  onConnected,
}: {
  cal: CalendarStateDto
  step: ConnectStep
  onStep: (s: ConnectStep) => void
  realMode: boolean
  onConnected: (next: CalendarStateDto, concluded: boolean) => void
}) {
  const { toast } = useAppState()
  const [conta, setConta] = useState<string | null>(null)
  const [conectando, setConectando] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const iniciar = () => {
    if (cal.googleConfigurado) {
      window.location.assign('/api/calendar/google/start')
      return
    }
    onStep('conta')
  }

  const pickConta = (email: string) => {
    if (conectando) return
    setConectando(true)
    setConta(email)
    timer.current = window.setTimeout(() => {
      setConectando(false)
      onStep('agendas')
    }, CONNECTING_MS)
  }

  const voltar = () => {
    window.clearTimeout(timer.current)
    setConectando(false)
    onStep(null)
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto bg-light-bg bg-[radial-gradient(900px_480px_at_30%_0%,#f3f7e2,transparent_70%)] p-8">
      {step === null && <Intro onGoogle={iniciar} />}

      {step === 'conta' && (
        <div className={cn(cardCls, 'relative w-[min(440px,100%)] gap-4 p-7')}>
          <button
            type="button"
            onClick={voltar}
            className="flex cursor-pointer items-center gap-[5px] self-start border-0 bg-transparent p-0 text-[12px] text-light-neutral-500 hover:text-light-text"
          >
            <ArrowLeft size={12} /> Voltar
          </button>
          <div className="flex items-center gap-2.5">
            <GoogleLogo size={20} className="text-light-accent-300" />
            <h2 className="m-0 text-[18px] font-medium leading-[1.2] tracking-normal">Escolha uma conta</h2>
          </div>
          <div className="-mt-1.5 text-[12.5px] text-light-neutral-500">para continuar no PearChat</div>
          <div className="flex flex-col overflow-hidden rounded-md border border-solid border-light-divider">
            {GOOGLE_CONTAS.map((c, i) => (
              <button
                key={c.email}
                type="button"
                onClick={() => pickConta(c.email)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 border-0 border-solid border-light-divider bg-transparent px-3.5 py-[13px] text-left text-light-text hover:bg-light-accent-900',
                  i > 0 && 'border-t',
                )}
              >
                <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-pill bg-light-accent-800 text-[12px] font-medium leading-none text-light-accent-200">
                  {c.sigla}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-[1.25]">{c.nome}</span>
                  <span className="block text-[11.5px] text-light-neutral-500">{c.email}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                toast({ icon: <GoogleLogo size={18} weight="fill" />, title: 'Outra conta', text: 'Abriria a janela de login do Google' })
              }
              className="flex cursor-pointer items-center gap-3 border-0 border-t border-solid border-light-divider bg-transparent px-3.5 py-[13px] text-left text-[13px] text-light-text hover:bg-light-accent-900"
            >
              <span className="grid h-[34px] w-[34px] place-items-center rounded-pill border border-dashed border-light-neutral-700">
                <UserPlus size={15} className="text-light-neutral-500" />
              </span>
              Usar outra conta
            </button>
          </div>
          {conectando && (
            <div className="absolute inset-0 flex animate-[zfFade_.2s_ease] flex-col items-center justify-center gap-3 rounded-md bg-white/[.88]">
              <Spinner />
              <div className="text-[13px] font-medium leading-none">Conectando com o Google…</div>
            </div>
          )}
        </div>
      )}

      {step === 'agendas' && (
        <AgendasStep
          cal={cal}
          realMode={realMode}
          email={realMode ? cal.email ?? '' : conta ?? ''}
          onCancel={async () => {
            if (realMode) {
              // Desistiu depois do OAuth real: desfaz a conexão recém-criada.
              try {
                onConnected(await api<CalendarStateDto>('/api/calendar', { method: 'DELETE' }), false)
              } catch {
                // mantém a conexão; o usuário pode desconectar depois
              }
            }
            onStep(null)
          }}
          onDone={(next) => {
            toast({ icon: <CalendarCheck size={18} weight="fill" />, title: 'Google Agenda conectado', text: next.email ?? '' })
            onConnected(next, true)
            onStep(null)
          }}
        />
      )}
    </div>
  )
}

function Intro({ onGoogle }: { onGoogle: () => void }) {
  return (
    <div className={cn(cardCls, 'w-[min(900px,100%)] flex-row flex-wrap items-center gap-9 p-9 animate-[zfIn_.35s_ease_both]')}>
      <div className="min-w-0 flex-[1_1_320px]">
        <div className="text-[10.5px] font-medium uppercase leading-none tracking-[.16em] text-light-accent-300">Agenda</div>
        <h2 className="m-0 mt-3 text-[30px] font-medium leading-[1.15] tracking-[-.02em]">Conecte sua agenda</h2>
        <p className="m-0 mt-2.5 max-w-[44ch] leading-[1.5] text-light-neutral-400 [text-wrap:pretty]">
          Seus compromissos ficam aqui e no Google ao mesmo tempo. Quem agenda pelo WhatsApp já aparece no seu calendário.
        </p>
        <div className="mt-6 flex flex-col gap-3.5">
          {BENEFICIOS.map((b) => (
            <div key={b.titulo} className="flex items-start gap-3">
              <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-md border border-solid border-light-accent-700 bg-light-accent-900">
                <b.icon size={15} className="text-light-accent-300" />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-[1.3]">{b.titulo}</div>
                <div className="mt-0.5 text-[12px] text-light-neutral-500 [text-wrap:pretty]">{b.texto}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-[260px] flex-[0_1_300px] flex-col gap-2.5">
        <div className="text-[12px] text-light-neutral-500">Escolha onde está sua agenda</div>
        <button
          type="button"
          onClick={onGoogle}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-solid border-light-accent-600 bg-light-accent-900 p-3.5 text-left text-light-text hover:border-light-accent-400"
        >
          <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] border border-solid border-light-divider bg-light-surface">
            <GoogleLogo size={19} className="text-light-accent-300" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium leading-[1.25]">Google Agenda</span>
            <span className="mt-0.5 block text-[11.5px] text-light-accent-300">Recomendado</span>
          </span>
          <ArrowRight size={14} className="text-light-accent-300" />
        </button>
        {OUTRAS.map((o) => (
          <div
            key={o.nome}
            aria-disabled="true"
            className="flex items-center gap-3 rounded-lg border border-solid border-light-divider p-3.5 opacity-[.55]"
          >
            <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] bg-light-neutral-900">
              <o.icon size={18} className="text-light-neutral-400" />
            </span>
            <span className="flex-1 text-[13.5px] font-medium leading-[1.25]">{o.nome}</span>
            <Tag tone="neutral" className="text-[10px]">
              Em breve
            </Tag>
          </div>
        ))}
      </div>
    </div>
  )
}

type CalOpt = { id: string; nome: string; desc: string; cor: string }

function AgendasStep({
  cal,
  realMode,
  email,
  onCancel,
  onDone,
}: {
  cal: CalendarStateDto
  realMode: boolean
  email: string
  onCancel: () => void
  onDone: (next: CalendarStateDto) => void
}) {
  const { toast } = useAppState()
  const destinoId = realMode ? cal.destinoId : DEMO_DESTINO
  const opts: CalOpt[] = realMode
    ? cal.calendarios.map((c, i) => ({
        id: c.id,
        nome: c.nome,
        desc: c.id === destinoId ? 'Onde os novos agendamentos são criados' : 'Só para bloquear horários ocupados',
        cor: c.cor ?? CAL_CORES[i % CAL_CORES.length],
      }))
    : DEMO_CALS.map((c) => ({ ...c }))
  const [sel, setSel] = useState<string[]>(() =>
    realMode ? cal.calendarios.filter((c) => c.selecionado).map((c) => c.id) : [...DEMO_SELECIONADAS],
  )
  const [saving, setSaving] = useState(false)
  const destinoNome = opts.find((o) => o.id === destinoId)?.nome ?? 'Doce Ateliê · Pedidos'

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const concluir = async () => {
    if (saving) return
    setSaving(true)
    try {
      const calendarios = opts.map((o) => ({ id: o.id, selecionado: sel.includes(o.id) }))
      const next = realMode
        ? await api<CalendarStateDto>('/api/calendar', { method: 'PATCH', body: { calendarios } })
        : await api<CalendarStateDto>('/api/calendar/connect-demo', {
            method: 'POST',
            body: {
              email,
              calendarios: opts.map((o) => ({ id: o.id, nome: o.nome, selecionado: sel.includes(o.id) })),
              destinoId: DEMO_DESTINO,
            },
          })
      onDone(next)
    } catch (e) {
      toast({
        icon: <Warning size={18} weight="fill" />,
        title: 'Não foi possível conectar',
        text: e instanceof Error ? e.message : 'Tente novamente em instantes.',
      })
      setSaving(false)
    }
  }

  return (
    <div className={cn(cardCls, 'w-[min(480px,100%)] gap-4 p-7')}>
      <div className="flex items-center gap-2 text-[12px] text-light-accent-300">
        <CheckCircle size={13} weight="fill" /> {email}
      </div>
      <h2 className="m-0 text-[18px] font-medium leading-[1.25] tracking-normal">Quais agendas o PearChat pode usar?</h2>
      <div className="flex flex-col gap-2">
        {opts.map((c) => {
          const on = sel.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(c.id)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border border-solid px-3.5 py-3 text-left text-light-text',
                on ? 'border-light-accent-600 bg-light-accent-900' : 'border-light-divider bg-transparent',
              )}
            >
              <span
                className={cn(
                  'grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border border-solid',
                  on ? 'border-light-accent-400 bg-light-accent-400' : 'border-light-neutral-700 bg-transparent',
                )}
              >
                {on && <Check size={11} weight="bold" className="text-[#fbfcf3]" />}
              </span>
              <span className="h-[9px] w-[9px] flex-none rounded-pill" style={{ background: c.cor }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-[1.25]">{c.nome}</span>
                <span className="mt-0.5 block text-[11.5px] text-light-neutral-500">{c.desc}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="text-[11.5px] text-light-neutral-500 [text-wrap:pretty]">
        Novos agendamentos vão para &quot;{destinoNome}&quot;. As outras agendas só servem para bloquear horários ocupados.
      </div>
      <div className="flex justify-end gap-2.5">
        <button type="button" onClick={onCancel} className="pc-btn pc-btn-ghost" disabled={saving}>
          Cancelar
        </button>
        <button type="button" onClick={() => void concluir()} className="pc-btn pc-btn-primary" disabled={saving}>
          {saving ? <Spinner size={14} /> : <Check size={14} />} Concluir conexão
        </button>
      </div>
    </div>
  )
}
