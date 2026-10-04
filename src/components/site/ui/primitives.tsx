import type { CSSProperties, ReactNode } from 'react'
import { CalendarCheck, Check, Checks, Sparkle } from '@/components/site/ui/icons'
import { cn } from '@/lib/utils'
import { windowShadow } from './styles'

// Peças das mini-interfaces da página inicial. Copiam as formas, cores e rótulos do app (balões de
// message-bubble.tsx, avatar de contact-avatar.tsx, etiquetas de pear/tag.tsx), mas são componentes leves,
// sem estado nem dados: funcionam em Server e Client Components.

export const AGENTE = 'Luna'

export function initials(nome: string) {
  return nome
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Avatar({ nome, size = 36, ia, className }: { nome: string; size?: number; ia?: boolean; className?: string }) {
  return (
    <span
      className={cn('relative grid flex-none place-items-center rounded-pill bg-light-neutral-900 font-medium leading-none text-light-accent-200', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      {initials(nome)}
      {ia && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-[16px] w-[16px] place-items-center rounded-pill border-2 border-white bg-light-accent-fill">
          <Sparkle size={8} weight="fill" color="#ffffff" />
        </span>
      )}
    </span>
  )
}

export function IaLabel({ agente = AGENTE }: { agente?: string }) {
  return (
    <span className="mb-1.5 flex items-center gap-[5px] text-[10.5px] font-medium leading-none text-light-accent-300">
      <Sparkle size={11} weight="fill" />
      {agente} · IA
    </span>
  )
}

type From = 'cliente' | 'ia' | 'equipe'

/** Balão de mensagem idêntico ao do app: recebido à esquerda (branco), enviado à direita (verde claro). */
export function Bubble({
  from,
  children,
  time,
  sender,
  read = true,
  pop = true,
  className,
  style,
}: {
  from: From
  children: ReactNode
  time?: string
  /** Nome de quem da equipe enviou (só para `equipe`). */
  sender?: string
  read?: boolean
  /** Entrada suave ao aparecer (padrão). */
  pop?: boolean
  className?: string
  style?: CSSProperties
}) {
  const received = from === 'cliente'
  return (
    <div className={cn(pop && 'lp-pop', 'flex', received ? 'justify-start' : 'justify-end', className)} style={style}>
      <div
        className={cn(
          'max-w-[82%] border px-[13px] pb-[7px] pt-[9px] text-[13px] leading-[1.45] text-light-text',
          received ? 'border-light-divider bg-white' : 'border-light-accent-700 bg-light-accent-900',
        )}
        style={{ borderRadius: received ? '14px 14px 14px 4px' : '14px 14px 4px 14px' }}
      >
        {from === 'ia' && <IaLabel />}
        {from === 'equipe' && sender && <span className="mb-1.5 block text-[10.5px] font-medium leading-none text-light-neutral-400">{sender}</span>}
        <div className="[text-wrap:pretty]">{children}</div>
        {time && (
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-light-neutral-400">
            {time}
            {!received && (read ? <Checks size={13} className="text-light-accent-300" /> : <Check size={12} />)}
          </div>
        )}
      </div>
    </div>
  )
}

/** "Luna está digitando": balão da IA com três pontos. */
export function TypingBubble({ className }: { className?: string }) {
  return (
    <div className={cn('lp-pop flex justify-end', className)}>
      <div className="border border-light-accent-700 bg-light-accent-900 px-[13px] pb-[10px] pt-[9px]" style={{ borderRadius: '14px 14px 4px 14px' }}>
        <IaLabel />
        <span className="lp-typing flex gap-1" aria-label={`${AGENTE} está digitando`}>
          <i className="h-1.5 w-1.5 rounded-pill bg-light-accent-500/70" />
          <i className="h-1.5 w-1.5 rounded-pill bg-light-accent-500/70" />
          <i className="h-1.5 w-1.5 rounded-pill bg-light-accent-500/70" />
        </span>
      </div>
    </div>
  )
}

/** Aviso centralizado dentro da conversa (ex.: agendamento criado, follow-up enviado). */
export function SystemNote({ children, icon, tone = 'accent', className }: { children: ReactNode; icon?: ReactNode; tone?: 'accent' | 'neutral'; className?: string }) {
  return (
    <div className={cn('lp-pop flex justify-center', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-pill border px-3 py-[6px] text-[11.5px] font-medium leading-none',
          tone === 'accent' ? 'border-light-accent-700 bg-white text-light-accent-200 shadow-[0_6px_16px_-8px_rgba(46,154,72,.45)]' : 'border-light-divider bg-light-bg text-light-neutral-400',
        )}
      >
        {icon ?? <CalendarCheck size={13} weight="bold" className="text-light-accent-400" />}
        {children}
      </span>
    </div>
  )
}

/** Divisor de tempo dentro da conversa ("2 h sem resposta"). */
export function TimeGap({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-[11px] text-light-neutral-400">
      <span className="h-px flex-1 border-t border-dashed border-light-neutral-700" />
      {children}
      <span className="h-px flex-1 border-t border-dashed border-light-neutral-700" />
    </div>
  )
}

export function Tag({ children, tone = 'accent', className }: { children: ReactNode; tone?: 'accent' | 'neutral' | 'amber'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center whitespace-nowrap rounded-[6px] px-[7px] py-[2px] text-[10px] leading-[1.3] tracking-[0.02em]',
        tone === 'accent' && 'bg-light-accent-800 text-light-accent-100',
        tone === 'neutral' && 'bg-light-neutral-800 text-light-neutral-100',
        tone === 'amber' && 'bg-amber-bg text-amber-text',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Interruptor do app (só visual). */
export function Switch({ on = true, dark = false }: { on?: boolean; dark?: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-block h-[20px] w-[34px] flex-none rounded-pill transition-colors',
        on ? (dark ? 'bg-dark-accent-500' : 'bg-light-accent-fill') : dark ? 'bg-dark-neutral-800' : 'bg-light-neutral-700',
      )}
    >
      <span className={cn('absolute top-[3px] h-[14px] w-[14px] rounded-pill bg-[#fbfcf3] shadow-sm transition-[left]', on ? 'left-[17px]' : 'left-[3px]')} />
    </span>
  )
}

/** Moldura de janela do produto: barra discreta com três pontos e o nome da tela. */
export function AppWindow({
  title,
  children,
  className,
  bodyClassName,
  bar = true,
  style,
}: {
  title?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
  bar?: boolean
  style?: CSSProperties
}) {
  return (
    <div className={cn('overflow-hidden rounded-[14px] bg-white text-left text-light-text', windowShadow, className)} style={style}>
      {bar && (
        <div className="relative flex h-[34px] items-center gap-1.5 border-b border-light-divider bg-[#fbfcf7] px-3.5">
          <span className="h-[9px] w-[9px] rounded-pill bg-light-neutral-800" />
          <span className="h-[9px] w-[9px] rounded-pill bg-light-neutral-800" />
          <span className="h-[9px] w-[9px] rounded-pill bg-light-neutral-800" />
          {title && <span className="absolute inset-x-0 text-center text-[11px] font-medium text-light-neutral-400">{title}</span>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

/** Rótulo de seção no estilo do app (.pc-section-label). */
export function MiniLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[10px] font-medium uppercase leading-none tracking-[.12em] text-light-neutral-400', className)}>{children}</div>
}

/** Texto alternativo curto para uma mini-interface marcada como aria-hidden. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}
