import { Hand, Lightning, MagnifyingGlass, Microphone, Paperclip, PaperPlaneRight, Sparkle } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { AGENTE, AppWindow, Avatar, Bubble, MiniLabel, Switch, SystemNote, Tag, TypingBubble } from '../ui/primitives'

/*
 * Mini-história do herói, como máquina de estados (a etapa 2 só precisa avançar `step` de 0 a HERO_FINAL):
 * 0 vazio · 1 pergunta do cliente · 2 IA digitando · 3 horários oferecidos · 4 cliente escolhe "16h"
 * 5 IA digitando · 6 pedido de confirmação · 7 cliente aceita · 8 agendamento criado (aparece também na Agenda ao fundo)
 */
export const HERO_FINAL = 8
export const HERO_STEP_NAMES = ['vazio', 'pergunta', 'digitando', 'horarios', 'escolha', 'digitando', 'confirmar', 'aceite', 'criado'] as const

type Msg = { at: number; from: 'cliente' | 'ia'; text: string; time: string }
const MSGS: Msg[] = [
  { at: 1, from: 'cliente', text: 'Oi, vocês têm horário amanhã?', time: '10:12' },
  { at: 3, from: 'ia', text: 'Temos às 14h e às 16h. Qual você prefere?', time: '10:12' },
  { at: 4, from: 'cliente', text: '16h', time: '10:13' },
  { at: 6, from: 'ia', text: 'Posso confirmar amanhã às 16h?', time: '10:13' },
  { at: 7, from: 'cliente', text: 'Pode!', time: '10:13' },
]

const OUTRAS = [
  { nome: 'Mariana Silva', previa: `${AGENTE}: Perfeito, até sábado!`, hora: '10:05', ia: true },
  { nome: 'Carlos Menezes', previa: 'Qual o valor do serviço?', hora: '09:58', novas: 2 },
  { nome: 'Ana Paula Ribeiro', previa: 'Áudio 0:12', hora: '09:41', audio: true, resp: 'Bruno Lima' },
  { nome: 'Juliana Freitas', previa: 'Você: Obrigado, Juliana!', hora: 'Ontem' },
]

function previa(step: number) {
  if (step >= HERO_FINAL) return { text: 'Agendamento criado', typing: false }
  if (step === 2 || step === 5) return { text: `${AGENTE} está digitando…`, typing: true }
  const last = [...MSGS].reverse().find((m) => m.at <= step)
  if (!last) return { text: '', typing: false }
  return { text: last.from === 'ia' ? `${AGENTE}: ${last.text}` : last.text, typing: false }
}

/** Janela principal do herói: lista + conversa do Rafael com a IA agendando. */
export function HeroChat({ step = HERO_FINAL, compact = false, className }: { step?: number; compact?: boolean; className?: string }) {
  const p = previa(step)
  return (
    <AppWindow title="Conversas" className={className} bodyClassName={cn('grid', compact ? 'grid-cols-1' : 'grid-cols-1 min-[768px]:grid-cols-[228px_minmax(0,1fr)]')}>
      {/* Lista */}
      <div className={cn('flex-col border-r border-light-divider bg-white', compact ? 'hidden' : 'hidden min-[768px]:flex')}>
        <div className="px-3 pb-2 pt-3">
          <div className="flex h-8 items-center gap-2 rounded-md border border-light-divider px-2.5 text-[12px] text-light-neutral-500">
            <MagnifyingGlass size={13} /> Buscar conversa
          </div>
          <div className="mt-2.5 flex gap-1">
            {['Todas', 'Não lidas', 'Com IA', 'Minhas'].map((f, i) => (
              <span
                key={f}
                className={cn(
                  'whitespace-nowrap rounded-pill border px-2 py-[3px] text-[10.5px]',
                  i === 0 ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200' : 'border-light-divider text-light-neutral-400',
                )}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-t border-light-divider bg-light-accent-900 px-3 py-2.5 shadow-[inset_3px_0_0_#2e9a48]">
          <Avatar nome="Rafael Costa" size={36} ia />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 truncate text-[12.5px] font-medium">Rafael Costa</span>
              <span className="text-[10px] text-light-accent-300">10:13</span>
            </div>
            <div className={cn('mt-0.5 truncate text-[11px]', p.typing ? 'text-light-accent-300' : 'text-light-neutral-500')}>{p.text}</div>
          </div>
        </div>
        {OUTRAS.map((c) => (
          <div key={c.nome} className="flex items-center gap-2.5 border-t border-light-divider px-3 py-2.5">
            <Avatar nome={c.nome} size={36} ia={c.ia} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 truncate text-[12.5px] font-medium">{c.nome}</span>
                <span className={cn('text-[10px]', c.novas ? 'text-light-accent-300' : 'text-light-neutral-500')}>{c.hora}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] text-light-neutral-500">
                  {c.audio && <Microphone size={12} className="flex-none" />}
                  <span className="truncate">{c.previa}</span>
                </span>
                {c.resp && <Avatar nome={c.resp} size={16} className="!text-[7px]" />}
                {c.novas && (
                  <span className="h-4 min-w-4 rounded-pill bg-light-accent-fill px-[5px] text-center text-[9.5px] font-medium leading-4 text-white">{c.novas}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Conversa */}
      <div className="flex min-w-0 flex-col bg-light-bg">
        <div className="flex items-center gap-2.5 border-b border-light-divider bg-white px-4 py-2.5">
          <Avatar nome="Rafael Costa" size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-tight">Rafael Costa</div>
            <div className="mt-0.5 text-[10.5px] text-light-neutral-500">(11) 98765-4321</div>
          </div>
          <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-pill border border-light-accent-700 bg-light-accent-900 px-2.5 py-[4px] text-[10.5px] text-light-accent-200 min-[480px]:flex">
            <Sparkle size={12} /> {AGENTE} (IA) respondendo
          </span>
          <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-light-accent-500 px-2.5 py-[5px] text-[10.5px] font-medium text-light-accent-300 min-[1100px]:inline-flex">
            <Hand size={12} /> Assumir conversa
          </span>
        </div>
        <div className="flex min-h-[330px] flex-1 flex-col justify-end gap-2 px-4 py-4">
          {MSGS.map((m, i) => {
            const typingBefore = (m.at === 3 && step === 2) || (m.at === 6 && step === 5)
            if (typingBefore) return <TypingBubble key={`t${i}`} />
            return m.at <= step ? (
              <Bubble key={i} from={m.from} time={m.time}>
                {m.text}
              </Bubble>
            ) : null
          })}
          {step >= HERO_FINAL && <SystemNote className="pt-1">Agendamento criado · amanhã, 16:00</SystemNote>}
        </div>
        <div className="flex items-center gap-2 border-t border-light-divider bg-white px-3 py-2.5">
          <Paperclip size={15} className="flex-none text-light-accent-500" />
          <Lightning size={15} className="flex-none text-light-accent-500" />
          <span className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-light-divider px-2.5 text-[12px] text-light-neutral-500">
            Escreva para assumir a conversa
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-light-accent-500 px-2.5 py-[6px] text-[11.5px] font-medium text-light-accent-300">
            <PaperPlaneRight size={13} /> Enviar
          </span>
        </div>
      </div>
    </AppWindow>
  )
}

/* ---------- Janelas ao fundo ---------- */

const HOURS = ['13:00', '14:00', '15:00', '16:00', '17:00']
const ROW = 38
type Ev = { day: number; start: number; dur: number; titulo: string; cliente: string; ia?: boolean; isNew?: boolean; tag?: string }
const EVENTS: Ev[] = [
  { day: 0, start: 14, dur: 1, titulo: 'Escova', cliente: 'Bianca Reis', tag: 'Confirmado' },
  { day: 0, start: 16, dur: 0.75, titulo: 'Corte', cliente: 'Diego Souza' },
  { day: 1, start: 13, dur: 0.75, titulo: 'Barba', cliente: 'Lucas Prado', ia: true },
  { day: 1, start: 15, dur: 0.75, titulo: 'Corte', cliente: 'Thiago Ramos', tag: 'Confirmado' },
  { day: 2, start: 13.5, dur: 1, titulo: 'Corte + barba', cliente: 'Pedro Alves' },
]

/** Agenda compacta (3 dias). `created` faz o horário do Rafael aparecer amanhã às 16:00. */
export function HeroAgenda({ created = true, className }: { created?: boolean; className?: string }) {
  const days = [
    { sem: 'QUI', n: '9', hoje: true },
    { sem: 'SEX', n: '10', sel: true },
    { sem: 'SÁB', n: '11' },
  ]
  const evs: Ev[] = created ? [...EVENTS, { day: 1, start: 16, dur: 0.75, titulo: 'Corte de cabelo', cliente: 'Rafael Costa', ia: true, isNew: true }] : EVENTS
  return (
    <AppWindow title="Agenda" className={className}>
      <div className="flex items-center gap-2 border-b border-light-divider px-3.5 py-2.5">
        <span className="text-[13px] font-medium">Esta semana</span>
        <span className="text-[11px] text-light-neutral-500">9 a 11</span>
        <span className="flex-1" />
        <span className="rounded-md border border-light-divider px-2 py-[3px] text-[10.5px]">Hoje</span>
      </div>
      <div className="grid grid-cols-[44px_repeat(3,minmax(0,1fr))] border-b border-light-divider">
        <div />
        {days.map((d) => (
          <div key={d.n} className={cn('flex flex-col items-center gap-1 border-l border-light-divider py-2', d.sel && 'bg-light-accent-900')}>
            <span className={cn('text-[9.5px] uppercase tracking-[.06em]', d.sel ? 'text-light-accent-300' : 'text-light-neutral-500')}>{d.sem}</span>
            <span
              className={cn(
                'grid h-6 w-6 place-items-center rounded-pill text-[12px] font-medium leading-none',
                d.hoje ? 'bg-light-accent-fill text-white' : d.sel ? 'bg-light-accent-800 text-light-accent-200' : '',
              )}
            >
              {d.n}
            </span>
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-[44px_repeat(3,minmax(0,1fr))]">
        <div>
          {HOURS.map((h) => (
            <div key={h} className="relative" style={{ height: ROW }}>
              <span className="absolute right-1.5 top-1 text-[9.5px] text-light-neutral-500">{h}</span>
            </div>
          ))}
        </div>
        {days.map((d, i) => (
          <div key={d.n} className={cn('relative border-l border-light-divider', d.sel && 'bg-[rgba(46,154,72,0.05)]')}>
            {HOURS.map((h) => (
              <div key={h} className="border-t border-light-divider" style={{ height: ROW }} />
            ))}
            {evs
              .filter((e) => e.day === i)
              .map((e) => (
                <div
                  key={e.cliente}
                  className={cn(
                    'absolute inset-x-1 overflow-hidden rounded-[7px] border border-l-[3px] px-1.5 py-1',
                    e.ia ? 'border-light-accent-700 bg-light-accent-900' : 'border-light-divider bg-white',
                    e.isNew && 'z-10 shadow-[0_0_0_2px_#2e9a48,0_10px_24px_-8px_rgba(46,154,72,.6)]',
                  )}
                  style={{ top: (e.start - 13) * ROW + 2, height: e.dur * ROW - 4, borderLeftColor: e.ia ? '#2e9a48' : '#d9a35b' }}
                >
                  <div className="flex items-center gap-1 truncate text-[10px] font-medium leading-[1.2] text-light-accent-200">
                    {e.ia && <Sparkle size={8} weight="fill" className="flex-none" />}
                    <span className="truncate">
                      {`${Math.floor(e.start)}:${e.start % 1 ? '30' : '00'}`} · {e.titulo}
                    </span>
                  </div>
                  <div className="truncate text-[9.5px] text-light-neutral-500">{e.cliente}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </AppWindow>
  )
}

const CONTATOS = [
  { nome: 'Rafael Costa', tel: '(11) 98765-4321', tags: ['Agendamento'] },
  { nome: 'Mariana Silva', tel: '(11) 97412-0091', tags: ['Cliente', 'VIP'] },
  { nome: 'Carlos Menezes', tel: '(11) 96610-3382', tags: ['Lead'] },
  { nome: 'Ana Paula Ribeiro', tel: '(11) 95527-1840', tags: ['Cliente'] },
]

export function HeroContacts({ className }: { className?: string }) {
  return (
    <AppWindow title="Contatos" className={className}>
      <div className="px-3.5 py-2.5">
        <div className="flex h-8 items-center gap-2 rounded-md border border-light-divider px-2.5 text-[11.5px] text-light-neutral-500">
          <MagnifyingGlass size={13} /> Buscar por nome, número ou etiqueta
        </div>
      </div>
      {CONTATOS.map((c) => (
        <div key={c.nome} className="flex items-center gap-2.5 border-t border-light-divider px-3.5 py-2.5">
          <Avatar nome={c.nome} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-medium">{c.nome}</span>
              {c.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
            <div className="mt-0.5 text-[10.5px] text-light-neutral-500">{c.tel}</div>
          </div>
        </div>
      ))}
    </AppWindow>
  )
}

export function HeroAgent({ className }: { className?: string }) {
  return (
    <AppWindow title="Agentes de IA" className={className} bodyClassName="flex flex-col gap-3.5 p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-light-accent-800 text-light-accent-200">
          <Sparkle size={16} />
        </span>
        <div className="flex-1">
          <div className="text-[12.5px] font-medium leading-tight">Agentes de IA</div>
          <div className="text-[10.5px] text-light-accent-300">{AGENTE} está respondendo</div>
        </div>
        <Switch />
      </div>
      <div>
        <MiniLabel className="mb-2">Tom de voz</MiniLabel>
        <div className="flex overflow-hidden rounded-md border border-light-divider text-[11px]">
          {['Amigável', 'Profissional', 'Direto'].map((t, i) => (
            <span key={t} className={cn('flex-1 py-1.5 text-center', i === 0 ? 'bg-light-accent-800 text-light-accent-200' : 'text-light-neutral-400')}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div>
        <MiniLabel className="mb-2">O que ele precisa saber</MiniLabel>
        <div className="flex flex-col gap-1.5">
          {[
            ['Horário de funcionamento', 'Seg a sáb, 9h às 19h'],
            ['Preço do corte', 'R$ 45'],
            ['Endereço', 'Rua das Flores, 120'],
          ].map(([p, r]) => (
            <div key={p} className="rounded-md border border-light-divider bg-light-bg px-2.5 py-1.5">
              <div className="text-[11px] font-medium">{p}</div>
              <div className="text-[10.5px] text-light-neutral-500">{r}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5 rounded-md border border-light-divider px-2.5 py-2">
        <span className="flex-1 text-[11px] leading-[1.3]">Permitir que o agente agende, remarque e cancele</span>
        <Switch />
      </div>
    </AppWindow>
  )
}
