import { CalendarCheck, Check, ClockClockwise, Bell, Sparkle, WhatsappLogo } from '@/components/site/ui/icons'
import { cn } from '@/lib/utils'
import { AGENTE, AppWindow, Avatar, MiniLabel, Switch } from '../ui/primitives'

// Painéis da seção "Como funciona" (um por etapa). Cada um tem um estado próprio para a etapa 2 animar.

/* ---------- 1. Conectar (QR Code) ---------- */

/** QR ilustrativo e determinístico (não codifica nada; mesmo desenho no servidor e no navegador). */
function FakeQr({ size = 25 }: { size?: number }) {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const finder = (x: number, y: number) => {
    const inF = (fx: number, fy: number) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7
    for (const [fx, fy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ] as const) {
      if (inF(fx, fy)) {
        const dx = x - fx
        const dy = y - fy
        return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) ? 1 : 0
      }
    }
    return -1
  }
  const cells: [number, number][] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = finder(x, y)
      const quiet = (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9)
      const on = f === 1 || (f === -1 && !quiet && rnd() > 0.52)
      if (on) cells.push([x, y])
    }
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" shapeRendering="crispEdges">
      <path d={cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')} fill="#1d2117" />
    </svg>
  )
}

/** aguardando · conectando · conectado */
export type ConnectState = 'aguardando' | 'conectando' | 'conectado'

export function ConnectPanel({ state = 'aguardando', className }: { state?: ConnectState; className?: string }) {
  return (
    <AppWindow title="Conectar WhatsApp" className={className} bodyClassName="grid grid-cols-1 items-center gap-6 p-6 min-[560px]:grid-cols-[minmax(0,1fr)_200px]">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[.12em] text-light-accent-300">Conexão por QR Code</span>
        </div>
        <div className="mt-2 text-[20px] font-medium leading-[1.15] tracking-[-0.02em]">Conecte seu WhatsApp</div>
        <ol className="mt-4 flex list-none flex-col gap-2.5 p-0">
          {['Abra o WhatsApp no celular que você usa para atender.', 'Vá em Dispositivos conectados.', 'Toque em Conectar um dispositivo e aponte a câmera.'].map((t, i) => (
            <li key={t} className="flex gap-2.5 text-[12px] leading-[1.45] text-light-neutral-400">
              <span className="grid h-5 w-5 flex-none place-items-center rounded-pill border border-light-accent-700 bg-light-accent-900 text-[10px] font-medium text-light-accent-200">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col items-center gap-2.5">
        <div className="relative h-[200px] w-[200px] rounded-lg border border-light-divider bg-white p-3">
          <FakeQr />
          {(
            <div className={cn('absolute inset-0 grid place-items-center rounded-lg bg-white/90 transition-opacity duration-500', state === 'aguardando' ? 'opacity-0' : 'opacity-100')}>
              {state === 'conectado' ? (
                <span key="ok" className="lp-pop flex flex-col items-center gap-2 text-[12.5px] font-medium text-light-accent-200">
                  <span className="grid h-11 w-11 place-items-center rounded-pill bg-light-accent-fill text-white">
                    <Check size={22} weight="bold" />
                  </span>
                  WhatsApp conectado
                </span>
              ) : (
                <span className="text-[12.5px] text-light-neutral-400">Conectando…</span>
              )}
            </div>
          )}
          <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[9px] border-[3px] border-white bg-light-accent-fill text-white">
            <WhatsappLogo size={17} weight="fill" />
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-light-neutral-400">
          <span className="h-1.5 w-1.5 rounded-pill bg-light-accent-500" />
          {state === 'conectado' ? 'Pronto para atender' : 'Aguardando leitura do código'}
        </span>
      </div>
    </AppWindow>
  )
}

/* ---------- 2. Ensinar a IA ---------- */

export const TEACH_ITEMS = [
  ['Horários', 'Seg a sáb, das 9h às 19h'],
  ['Serviços', 'Corte, escova, coloração e limpeza de pele'],
  ['Preços', 'Corte feminino R$ 80 · Escova R$ 50'],
  ['Endereço', 'Rua das Flores, 120, Centro'],
  ['Perguntas frequentes', 'Tem estacionamento? Sim, gratuito para clientes.'],
] as const

/** `filled` = quantos itens já foram escritos (0 a 5). */
export function TeachPanel({ filled = TEACH_ITEMS.length, className }: { filled?: number; className?: string }) {
  return (
    <AppWindow title="Agentes de IA" className={className} bodyClassName="flex flex-col gap-4 p-5">
      <div>
        <MiniLabel className="mb-2">Instruções</MiniLabel>
        <div className="rounded-md border border-light-divider bg-white px-3 py-2.5 text-[12px] leading-[1.5] text-light-neutral-300">
          Você é a {AGENTE}, atendente do Studio Bella. Responda com simpatia, em mensagens curtas, e só sobre o salão.
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <MiniLabel>O que ele precisa saber</MiniLabel>
          <span className="text-[10.5px] text-light-neutral-400">{filled} respostas</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {TEACH_ITEMS.map(([p, r], i) => (
            <div
              key={p}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2 transition-[opacity,background-color,border-color] duration-300',
                i < filled ? 'border-light-divider bg-light-bg' : 'border-dashed border-light-divider opacity-40',
              )}
            >
              <span className="w-[110px] flex-none text-[11.5px] font-medium">{p}</span>
              <span key={i < filled ? 'on' : 'off'} className={cn('min-w-0 flex-1 truncate text-[11.5px] text-light-neutral-400', i < filled && 'lp-pop')}>{i < filled ? r : ' '}</span>
              {i < filled && <Check size={12} weight="bold" className="flex-none text-light-accent-400" />}
            </div>
          ))}
        </div>
      </div>
    </AppWindow>
  )
}

/* ---------- 3. Ligar as automações ---------- */

const AUTOS = [
  { Ico: Sparkle, t: 'Agentes de IA', sub: `${AGENTE} está respondendo` },
  { Ico: ClockClockwise, t: 'Follow-up automático', sub: 'Retoma quem parou de responder' },
  { Ico: Bell, t: 'Lembretes da agenda', sub: 'Com confirmação de presença' },
]

/** `on` = quantas automações já estão ligadas (0 a 3). */
export function AutomationsPanel({ on = AUTOS.length, className }: { on?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-[14px] border border-dark-divider bg-[linear-gradient(180deg,#12251a_0%,#14170f_55%)] p-5 text-dark-text shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)]', className)}>
      <div className="flex items-baseline justify-between px-1 pb-3">
        <span className="text-[10.5px] font-medium uppercase tracking-[.14em] text-dark-neutral-500">Automações</span>
        <span className="text-[11px] text-dark-neutral-500">{on} de 3 ligadas</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {AUTOS.map(({ Ico, t, sub }, i) => {
          const ligado = i < on
          return (
            <div
              key={t}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3.5 py-3.5 transition-colors duration-300',
                ligado ? 'border-dark-accent-700 bg-[color-mix(in_srgb,#5ccb6e_12%,#1d2117)]' : 'border-dark-divider bg-dark-surface',
              )}
            >
              <span className={cn('grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px]', ligado ? 'bg-dark-accent-800 text-dark-accent-200' : 'bg-dark-neutral-900 text-dark-neutral-400')}>
                <Ico size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium leading-[1.25]">{t}</span>
                <span className={cn('mt-[3px] block truncate text-[11.5px]', ligado ? 'text-dark-accent-300' : 'text-dark-neutral-500')}>{ligado ? sub : 'Desligado'}</span>
              </span>
              <span className={cn('hidden rounded-pill border px-2 py-[2px] text-[10.5px] min-[400px]:inline', ligado ? 'border-dark-accent-700 text-dark-accent-300' : 'border-dark-divider text-dark-neutral-500')}>
                {ligado ? 'Ligada' : 'Desligada'}
              </span>
              <Switch on={ligado} dark />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- 4. O PearChat trabalhando ---------- */

const FEED = [
  { nome: 'Fernanda Lopes', previa: `${AGENTE}: Tenho às 10h e às 15h.`, hora: 'agora', ia: true },
  { nome: 'Rafael Costa', previa: 'Agendamento criado · sex, 16:00', hora: '1 min', ia: true, kind: 'agenda' as const },
  { nome: 'Patrícia Gomes', previa: 'Follow-up enviado', hora: '3 min', kind: 'followup' as const },
  { nome: 'Beatriz Sousa', previa: `${AGENTE}: A escova custa R$ 50.`, hora: '6 min', ia: true },
  { nome: 'Carlos Menezes', previa: 'Qual o valor do serviço?', hora: '8 min', novas: 1 },
]

/** `count` = quantas conversas já chegaram (0 a 5); chegam de baixo para cima e a mais nova fica no topo. As linhas ficam reservadas (sem mexer no layout). */
export function WorkingPanel({ count = FEED.length, className }: { count?: number; className?: string }) {
  return (
    <AppWindow title="Conversas" className={className}>
      <div className="flex items-center gap-2 border-b border-light-divider px-4 py-3">
        <span className="text-[13.5px] font-medium">Hoje</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-pill border border-light-accent-700 bg-light-accent-900 px-2.5 py-[4px] text-[11px] text-light-accent-200">
          <Sparkle size={11} weight="fill" /> {AGENTE} respondendo
        </span>
      </div>
      {FEED.map((c, i) => (
        <div
          key={c.nome}
          className={cn(
            'flex items-center gap-3 border-b border-light-divider px-4 py-3 transition-[opacity,transform] duration-500 ease-out last:border-b-0',
            FEED.length - i <= count ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
          )}
        >
          <Avatar nome={c.nome} size={38} ia={c.ia} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 truncate text-[13px] font-medium">{c.nome}</span>
              <span className="text-[10.5px] text-light-neutral-400">{c.hora}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {c.kind === 'agenda' && <CalendarCheck size={13} weight="bold" className="flex-none text-light-accent-400" />}
              {c.kind === 'followup' && <ClockClockwise size={13} weight="bold" className="flex-none text-light-accent-400" />}
              <span className={cn('flex-1 truncate text-[12px]', c.kind ? 'font-medium text-light-accent-300' : 'text-light-neutral-400')}>{c.previa}</span>
              {c.novas && <span className="h-[18px] min-w-[18px] rounded-pill bg-light-accent-fill px-[5px] text-center text-[10.5px] font-medium leading-[18px] text-white">{c.novas}</span>}
            </div>
          </div>
        </div>
      ))}
    </AppWindow>
  )
}
