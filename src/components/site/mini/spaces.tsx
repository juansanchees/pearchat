'use client'

import { useState } from 'react'
import { ClockClockwise, Hand, PaperPlaneTilt, Plus, Sparkle, WhatsappLogo } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { AGENTE, AppWindow, Avatar, Switch } from '../ui/primitives'

// Vários WhatsApps na mesma conta: o menu escuro do app (cartões dos números + automações) e a lista de conversas
// do número escolhido. Ilha de cliente pequena: só guarda qual número está ativo. Etapa 2: animar a troca da lista.

type Conv = { nome: string; previa: string; hora: string; ia?: boolean; novas?: number }
type Space = { id: string; nome: string; numero: string; ia: boolean; followup: boolean; disparos: boolean; pendentes: number; convs: Conv[] }

export const SPACES: Space[] = [
  {
    id: 'centro',
    nome: 'Loja Centro',
    numero: '(11) 3456-0101',
    ia: true,
    followup: true,
    disparos: false,
    pendentes: 0,
    convs: [
      { nome: 'Camila Duarte', previa: `${AGENTE}: Abrimos às 9h amanhã.`, hora: '16:40', ia: true },
      { nome: 'Gustavo Pires', previa: 'Vocês fazem troca sem etiqueta?', hora: '16:32', novas: 1 },
      { nome: 'Helena Martins', previa: `${AGENTE}: Fica na Rua das Flores, 120.`, hora: '16:05', ia: true },
      { nome: 'Igor Batista', previa: 'Você: Separei para você!', hora: '15:48' },
    ],
  },
  {
    id: 'atendimento',
    nome: 'Atendimento',
    numero: '(11) 3456-0202',
    ia: true,
    followup: false,
    disparos: false,
    pendentes: 3,
    convs: [
      { nome: 'Larissa Moura', previa: 'Consigo trocar o horário de amanhã?', hora: '16:44', novas: 2 },
      { nome: 'Otávio Cruz', previa: `${AGENTE}: Vou passar para a equipe.`, hora: '16:21', ia: true },
      { nome: 'Sabrina Leal', previa: 'Obrigada pela ajuda!', hora: '15:10' },
    ],
  },
  {
    id: 'comercial',
    nome: 'Comercial',
    numero: '(11) 3456-0303',
    ia: false,
    followup: true,
    disparos: true,
    pendentes: 5,
    convs: [
      { nome: 'Construtora Alfa', previa: 'Podem enviar o orçamento?', hora: '16:50', novas: 3 },
      { nome: 'Daniel Teixeira', previa: 'Você: Segue a proposta em anexo.', hora: '16:12' },
      { nome: 'Escola Horizonte', previa: 'Qual o prazo de entrega?', hora: '14:37', novas: 2 },
      { nome: 'Fábio Nogueira', previa: 'Combinado, fico no aguardo.', hora: 'Ontem' },
    ],
  },
]

export function SpacesSwitcher({ initial = 'centro', className }: { initial?: string; className?: string }) {
  const [active, setActive] = useState(initial)
  const sp = SPACES.find((s) => s.id === active) ?? SPACES[0]!
  const autos = [
    { Ico: Sparkle, t: 'Agentes de IA', on: sp.ia, sub: sp.ia ? `${AGENTE} está respondendo` : 'Desligado' },
    { Ico: ClockClockwise, t: 'Follow-up automático', on: sp.followup, sub: sp.followup ? 'Ligado' : 'Desligado' },
    { Ico: PaperPlaneTilt, t: 'Disparos automáticos', on: sp.disparos, sub: sp.disparos ? '1 campanha agendada' : 'Pausado' },
  ]
  return (
    <AppWindow title="PearChat" className={className} bodyClassName="grid grid-cols-1 min-[720px]:grid-cols-[296px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2 bg-[linear-gradient(180deg,#12251a_0%,#14170f_45%)] p-3.5 text-dark-text">
        <div className="px-1 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[.14em] text-dark-neutral-500">Seus WhatsApps</div>
        <div role="group" aria-label="Escolha um WhatsApp" className="flex flex-col gap-2">
          {SPACES.map((s) => {
            const on = s.id === active
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(s.id)}
                className={cn(
                  'flex w-full items-center gap-[11px] rounded-lg border p-[11px] text-left transition-colors duration-200',
                  on ? 'border-dark-accent-500 bg-[color-mix(in_srgb,#5ccb6e_14%,#1d2117)]' : 'border-dark-divider bg-dark-surface hover:border-dark-accent-600',
                )}
              >
                <span className="grid h-8 w-8 flex-none place-items-center rounded-pill border border-dark-accent-700 bg-dark-accent-900">
                  <WhatsappLogo size={16} className="text-dark-accent-300" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium leading-[1.25]">{s.nome}</span>
                  <span className="mt-[2px] block truncate text-[10.5px] text-dark-neutral-400">Conexão rápida · {s.numero}</span>
                </span>
                {!on && s.pendentes > 0 && (
                  <span className="flex flex-none items-center gap-[3px] rounded-pill bg-dark-accent-500 px-[6px] py-[1px] text-[10px] font-medium leading-[1.5] text-dark-accent-900">
                    {s.pendentes}
                  </span>
                )}
                <span className="h-2 w-2 flex-none rounded-pill bg-dark-accent-400" aria-hidden="true" />
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-[11px] rounded-lg border border-dashed border-dark-neutral-700 p-[11px] text-dark-neutral-300" aria-hidden="true">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-pill border border-dashed border-dark-neutral-700">
            <Plus size={14} className="text-dark-neutral-400" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium leading-[1.25]">Adicionar WhatsApp</span>
            <span className="mt-[2px] block text-[10.5px] text-dark-neutral-500">3 de 3 no seu plano</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between px-1 pb-0.5 pt-3" aria-hidden="true">
          <span className="text-[10px] font-medium uppercase tracking-[.14em] text-dark-neutral-500">Automações</span>
          <span className="text-[10.5px] text-dark-neutral-500">{autos.filter((a) => a.on).length} de 3 ligadas</span>
        </div>
        <div className="flex flex-col gap-1.5" aria-hidden="true">
          {autos.map(({ Ico, t, on, sub }) => (
            <div
              key={t}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors duration-200',
                on ? 'border-dark-accent-700 bg-[color-mix(in_srgb,#5ccb6e_12%,#1d2117)]' : 'border-dark-divider bg-dark-surface',
              )}
            >
              <span className={cn('grid h-7 w-7 flex-none place-items-center rounded-[8px]', on ? 'bg-dark-accent-800 text-dark-accent-200' : 'bg-dark-neutral-900 text-dark-neutral-400')}>
                <Ico size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium leading-[1.2]">{t}</span>
                <span className={cn('block truncate text-[10.5px]', on ? 'text-dark-accent-300' : 'text-dark-neutral-500')}>{sub}</span>
              </span>
              <Switch on={on} dark />
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col bg-white" aria-live="polite">
        <div className="flex items-center gap-2 border-b border-light-divider px-4 py-3">
          <span className="text-[13.5px] font-medium">{sp.nome}</span>
          <span className="text-[11.5px] text-light-neutral-500">· {sp.convs.length} conversas hoje</span>
          {sp.pendentes > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-pill bg-light-accent-900 px-2 py-[3px] text-[10.5px] text-light-accent-200">
              <Hand size={11} weight="fill" aria-hidden="true" /> {sp.pendentes} aguardando
            </span>
          )}
        </div>
        <ul key={sp.id} className="m-0 list-none p-0">
          {sp.convs.map((c) => (
            <li key={c.nome} className="flex items-center gap-3 border-b border-light-divider px-4 py-3">
              <Avatar nome={c.nome} size={38} ia={c.ia} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 truncate text-[13px] font-medium">{c.nome}</span>
                  <span className={cn('text-[10.5px]', c.novas ? 'text-light-accent-300' : 'text-light-neutral-500')}>{c.hora}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="flex-1 truncate text-[12px] text-light-neutral-500">{c.previa}</span>
                  {c.novas && <span className="h-[18px] min-w-[18px] rounded-pill bg-light-accent-fill px-[5px] text-center text-[10.5px] font-medium leading-[18px] text-white">{c.novas}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AppWindow>
  )
}
