import {
  ArrowsClockwise,
  Camera,
  Check,
  Clock,
  CurrencyCircleDollar,
  GearSix,
  Hand,
  Lightning,
  ListBullets,
  MagnifyingGlass,
  MapPin,
  Microphone,
  Paperclip,
  PaperPlaneRight,
  Play,
  Question,
  Sparkle,
  User,
} from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { AGENTE, AppWindow, Avatar, Bubble, MiniLabel, SystemNote, TimeGap } from '../ui/primitives'

function ChatHead({ nome, tel, mode = 'ia', resp }: { nome: string; tel: string; mode?: 'ia' | 'humano'; resp?: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-light-divider bg-white px-4 py-3">
      <Avatar nome={nome} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium leading-tight">{nome}</div>
        <div className="mt-0.5 text-[11px] text-light-neutral-500">{tel}</div>
      </div>
      {mode === 'ia' ? (
        <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-pill border border-light-accent-700 bg-light-accent-900 px-2.5 py-[4px] text-[11px] text-light-accent-200 min-[420px]:flex">
          <Sparkle size={12} /> {AGENTE} (IA) respondendo
        </span>
      ) : (
        <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-pill border border-light-divider bg-light-bg px-2.5 py-[4px] text-[11px] text-light-neutral-400 min-[420px]:flex">
          <User size={12} /> Você está atendendo
        </span>
      )}
      {resp && (
        <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-pill border border-light-divider py-[3px] pl-[3px] pr-2.5 text-[11px] min-[1100px]:flex">
          <Avatar nome={resp} size={20} className="!text-[8px]" />
          {resp}
        </span>
      )}
      {mode === 'humano' && (
        <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-light-divider px-2.5 py-[5px] text-[11px] font-medium min-[640px]:inline-flex">
          <Sparkle size={12} /> Devolver para IA
        </span>
      )}
    </div>
  )
}

/* ---------- Agente de IA ---------- */

/** 0 vazio · 1 pergunta · 2 resposta · 3 segunda pergunta · 4 pedido de confirmação */
export const AI_CHAT_FINAL = 4
const AI_MSGS = [
  { from: 'cliente' as const, text: 'Vocês atendem sábado?', time: '18:41' },
  { from: 'ia' as const, text: 'Sim! Aos sábados atendemos das 9h às 18h.', time: '18:41' },
  { from: 'cliente' as const, text: 'Tem horário às 14h?', time: '18:42' },
  { from: 'ia' as const, text: 'Tenho sim. Posso confirmar sábado às 14h?', time: '18:42' },
]

export function AiChat({ step = AI_CHAT_FINAL, className }: { step?: number; className?: string }) {
  return (
    <AppWindow title="Conversas" className={className} bodyClassName="flex flex-col bg-light-bg">
      <ChatHead nome="Juliana Freitas" tel="(11) 97744-2210" />
      <div className="flex min-h-[330px] flex-col justify-end gap-2.5 px-5 pb-5 pt-4">
        <div className="mb-2 self-center rounded-pill bg-white px-3 py-1 text-[10.5px] text-light-neutral-500 shadow-[0_0_0_1px_#e3e7d6]">Hoje</div>
        {AI_MSGS.slice(0, step).map((m, i) => (
          <Bubble key={i} from={m.from} time={m.time} className="text-[14px]">
            {m.text}
          </Bubble>
        ))}
      </div>
      <Composer />
    </AppWindow>
  )
}

function Composer({ text = 'Escreva para assumir a conversa' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-light-divider bg-white px-4 py-3">
      <Paperclip size={16} className="flex-none text-light-accent-500" />
      <Lightning size={16} className="flex-none text-light-accent-500" />
      <span className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border border-light-divider px-2.5 text-[12.5px] text-light-neutral-500">{text}</span>
      <span className="inline-flex items-center gap-1.5 rounded-md border border-light-accent-500 px-3 py-2 text-[12.5px] font-medium text-light-accent-300">
        <PaperPlaneRight size={14} /> Enviar
      </span>
    </div>
  )
}

const SABE = [
  { Icon: Clock, t: 'Horários' },
  { Icon: ListBullets, t: 'Serviços' },
  { Icon: CurrencyCircleDollar, t: 'Preços' },
  { Icon: MapPin, t: 'Endereço' },
  { Icon: Question, t: 'Perguntas frequentes' },
]

export function KnowledgeCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[14px] border border-light-divider bg-white p-4 text-light-text shadow-[0_30px_60px_-24px_rgba(29,33,23,.4)]', className)}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-light-accent-800 text-light-accent-200">
          <Sparkle size={14} weight="fill" />
        </span>
        <span className="text-[13px] font-medium">O que a IA sabe</span>
        <span className="ml-auto text-[11px] text-light-neutral-500">5 de 5</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {SABE.map(({ Icon, t }) => (
          <li key={t} className="flex items-center gap-1.5 rounded-pill border border-light-divider bg-light-bg py-[5px] pl-2.5 pr-2 text-[12px]">
            <Icon size={14} className="text-light-neutral-500" />
            {t}
            <Check size={12} weight="bold" className="text-light-accent-400" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Follow-up ---------- */

/** 0 conversa parada · 1 "2 h sem resposta" · 2 follow-up enviado · 3 mensagem de retomada · 4 cliente volta */
export const FOLLOWUP_FINAL = 4

export function FollowupChat({ step = FOLLOWUP_FINAL, className }: { step?: number; className?: string }) {
  return (
    <AppWindow title="Conversas" className={className} bodyClassName="flex flex-col bg-light-bg">
      <ChatHead nome="Patrícia Gomes" tel="(11) 99120-4488" />
      <div className="flex min-h-[380px] flex-col justify-end gap-2.5 px-5 py-5">
        <Bubble from="ia" time="10:02">
          A limpeza de pele custa R$ 120 e leva cerca de 1 hora. Quer ver os horários desta semana?
        </Bubble>
        <Bubble from="cliente" time="10:05">
          Vou pensar e te aviso.
        </Bubble>
        {step >= 1 && <TimeGap>2 h sem resposta</TimeGap>}
        {step >= 2 && (
          <SystemNote icon={<ArrowsClockwise size={13} weight="bold" className="text-light-accent-400" />}>Follow-up automático enviado</SystemNote>
        )}
        {step >= 3 && (
          <Bubble from="equipe" time="12:05">
            Oi! Conseguiu analisar? Se precisar, posso te ajudar 😊
          </Bubble>
        )}
        {step >= 4 && (
          <Bubble from="cliente" time="12:11">
            Consegui sim! Tem horário na sexta?
          </Bubble>
        )}
      </div>
    </AppWindow>
  )
}

function Seg({ opts, sel }: { opts: string[]; sel: string }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-light-divider text-[11.5px]">
      {opts.map((o) => (
        <span key={o} className={cn('flex-1 whitespace-nowrap px-2 py-1.5 text-center', o === sel ? 'bg-light-accent-800 text-light-accent-200' : 'text-light-neutral-400')}>
          {o}
        </span>
      ))}
    </div>
  )
}

export function FollowupRules({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3.5 rounded-[14px] border border-light-divider bg-white p-4 shadow-[0_30px_60px_-24px_rgba(29,33,23,.4)]', className)}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-light-accent-800 text-light-accent-200">
          <ArrowsClockwise size={14} />
        </span>
        <span className="text-[13px] font-medium">Follow-up automático</span>
      </div>
      <div>
        <MiniLabel className="mb-2">Se não responder em</MiniLabel>
        <Seg opts={['2 h', '6 h', '24 h']} sel="2 h" />
      </div>
      <div>
        <MiniLabel className="mb-2">Tentativas</MiniLabel>
        <Seg opts={['1', '2', '3']} sel="2" />
      </div>
      <div>
        <MiniLabel className="mb-2">Parar quando</MiniLabel>
        <div className="flex flex-wrap gap-1.5">
          {['Cliente respondeu', 'Cliente pediu para parar'].map((c) => (
            <span key={c} className="rounded-pill border border-light-accent-600 bg-light-accent-900 px-2.5 py-1 text-[11px] text-light-accent-200">
              {c}
            </span>
          ))}
        </div>
      </div>
      <p className="flex items-start gap-1.5 rounded-md bg-light-bg px-2.5 py-2 text-[11px] leading-[1.4] text-light-neutral-400">
        <Hand size={13} className="mt-px flex-none" /> Para sozinho quando alguém da equipe assume a conversa.
      </p>
    </div>
  )
}

/* ---------- Central de conversas e equipe ---------- */

const INBOX = [
  { nome: 'Ana Paula Ribeiro', previa: 'Bruno: Oi, Ana! É possível sim.', hora: '14:24', ativa: true, resp: 'Bruno Lima' },
  { nome: 'Fernanda Lopes', previa: `${AGENTE}: Tenho às 10h e às 15h.`, hora: '14:19', ia: true },
  { nome: 'Rodrigo Alves', previa: 'Foto', foto: true, hora: '14:02', novas: 1, resp: 'Carla Dias' },
  { nome: 'Beatriz Sousa', previa: 'Qual o valor da escova?', hora: '13:47', novas: 2 },
  { nome: 'Juliana Freitas', previa: `${AGENTE}: Posso confirmar sábado às 14h?`, hora: '13:30', ia: true },
  { nome: 'Marcos Vieira', previa: 'Você: Combinado, até amanhã!', hora: 'Ontem' },
]

/** Estados: `quickReplies` abre o menu de respostas rápidas (o atendente digitou "/"). */
export function Inbox({ quickReplies = true, className }: { quickReplies?: boolean; className?: string }) {
  return (
    <AppWindow title="Conversas" className={className} bodyClassName="grid grid-cols-1 min-[900px]:grid-cols-[300px_minmax(0,1fr)]">
      <div className="hidden flex-col border-r border-light-divider bg-white min-[900px]:flex">
        <div className="flex flex-col gap-2.5 px-3.5 pb-2.5 pt-3.5">
          <div className="flex h-9 items-center gap-2 rounded-md border border-light-divider px-2.5 text-[12.5px] text-light-neutral-500">
            <MagnifyingGlass size={14} /> Buscar conversa
          </div>
          <div className="flex gap-1.5">
            {['Todas', 'Não lidas', 'Com IA', 'Minhas'].map((f, i) => (
              <span
                key={f}
                className={cn(
                  'whitespace-nowrap rounded-pill border px-[10px] py-[4px] text-[11px]',
                  i === 0 ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200' : 'border-light-divider text-light-neutral-400',
                )}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        {INBOX.map((c) => (
          <div
            key={c.nome}
            className={cn('flex items-center gap-3 border-t border-light-divider px-3.5 py-3', c.ativa && 'bg-light-accent-900 shadow-[inset_3px_0_0_#2e9a48]')}
          >
            <Avatar nome={c.nome} size={40} ia={c.ia} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="flex-1 truncate text-[13px] font-medium">{c.nome}</span>
                <span className={cn('text-[10.5px]', c.novas ? 'text-light-accent-300' : 'text-light-neutral-500')}>{c.hora}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11.5px] text-light-neutral-500">
                  {c.foto && <Camera size={12} className="flex-none" />}
                  <span className="truncate">{c.previa}</span>
                </span>
                {c.resp && <Avatar nome={c.resp} size={18} className="!text-[7.5px]" />}
                {c.novas && <span className="h-[18px] min-w-[18px] rounded-pill bg-light-accent-fill px-[5px] text-center text-[10.5px] font-medium leading-[18px] text-white">{c.novas}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-col bg-light-bg">
        <ChatHead nome="Ana Paula Ribeiro" tel="(11) 95527-1840" mode="humano" resp="Bruno Lima" />
        <div className="flex flex-1 flex-col justify-end gap-2.5 px-5 pb-3 pt-5">
          <div className="flex justify-start">
            <div className="max-w-[78%] border border-light-divider bg-white p-1.5 text-[13px]" style={{ borderRadius: '14px 14px 14px 4px' }}>
              <div
                className="h-[150px] w-[230px] max-w-full rounded-[10px]"
                style={{
                  background:
                    'radial-gradient(60% 70% at 30% 35%, #c98a5b 0%, transparent 60%), radial-gradient(50% 60% at 70% 60%, #7a3f2a 0%, transparent 70%), radial-gradient(40% 50% at 55% 20%, #e8c39a 0%, transparent 70%), linear-gradient(160deg, #5b2e1f, #2b1a14)',
                }}
              />
              <div className="px-1.5 pb-0.5 pt-1.5">Quero fazer essa cor. É possível?</div>
              <div className="px-1.5 text-right text-[10px] text-light-neutral-500">14:20</div>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="flex w-[250px] max-w-[78%] items-center gap-2.5 border border-light-divider bg-white px-3 py-2.5" style={{ borderRadius: '14px 14px 14px 4px' }}>
              <span className="grid h-8 w-8 flex-none place-items-center rounded-pill bg-light-accent-fill text-white">
                <Play size={13} weight="fill" />
              </span>
              <span className="flex h-6 flex-1 items-center gap-[2px]">
                {[6, 12, 18, 10, 22, 14, 8, 16, 20, 12, 6, 14, 18, 10, 8, 12, 16, 8, 5, 10].map((h, i) => (
                  <i key={i} className={cn('w-[3px] rounded-pill', i < 7 ? 'bg-light-accent-500' : 'bg-light-neutral-700')} style={{ height: h }} />
                ))}
              </span>
              <span className="text-[10.5px] text-light-neutral-500">0:12</span>
            </div>
          </div>
          <Bubble from="ia" time="14:21">
            Vou chamar alguém da equipe para te ajudar com a cor, tudo bem?
          </Bubble>
          <Bubble from="equipe" sender="Bruno" time="14:24">
            Oi, Ana! É possível sim. Vou te passar os valores.
          </Bubble>
        </div>
        <div className="relative flex items-center gap-2 border-t border-light-divider bg-white px-4 py-3">
          {quickReplies && (
            <div className="absolute bottom-full left-4 right-4 mb-1 hidden rounded-lg min-[640px]:block border border-light-divider bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.18)] min-[640px]:right-auto min-[640px]:w-[370px]">
              {[
                ['precos', 'Corte feminino R$ 80 · Escova R$ 50 · Coloração a partir de R$ 180'],
                ['endereco', 'Rua das Flores, 120, Centro'],
                ['horarios', 'Seg a sáb, das 9h às 19h'],
              ].map(([a, t], i) => (
                <div key={a} className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px]', i === 0 && 'bg-[rgba(29,33,23,.07)]')}>
                  <span className="flex-none font-mono text-[11.5px] text-light-accent-300">/{a}</span>
                  <span className="min-w-0 flex-1 truncate text-light-neutral-500">{t}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-2.5 border-t border-light-divider px-2.5 pb-1.5 pt-2.5 text-[12px]">
                <GearSix size={13} className="text-light-neutral-500" /> Gerenciar respostas rápidas
              </div>
            </div>
          )}
          <Paperclip size={16} className="flex-none text-light-accent-500" />
          <Lightning size={16} className="flex-none text-light-accent-500" />
          <span className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-light-accent-500 px-2.5 text-[13px]">
            /<span className="ml-px h-4 w-px bg-light-accent-500" />
          </span>
          <span className="hidden items-center gap-1.5 rounded-md border border-light-accent-500 px-3 py-2 text-[12.5px] font-medium text-light-accent-300 min-[480px]:inline-flex">
            <PaperPlaneRight size={14} /> Enviar
          </span>
          <Microphone size={16} className="hidden flex-none text-light-accent-500 min-[480px]:block" />
        </div>
      </div>
    </AppWindow>
  )
}
