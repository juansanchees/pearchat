import type { ReactNode } from 'react'
import { ArrowLeft, Leaf } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { buildQrMatrix, QR_SIZE } from '@/server/whatsapp/qr-matrix'

// Classes do protótipo (.btn, .input, .tag, .card) traduzidas para Tailwind no tema claro do <main>.
export const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-md border px-[10px] py-[5.6px] text-[14px] font-medium leading-[1.2] transition-colors disabled:cursor-not-allowed disabled:opacity-45'
export const btnPrimary = cn(btn, 'border-light-accent-500 bg-transparent text-light-accent-500 hover:bg-light-accent-500/10 active:bg-light-accent-500/20')
export const btnSecondary = cn(btn, 'border-light-divider bg-transparent text-light-text hover:bg-light-text/[.07] active:bg-light-text/[.14]')
export const inputCls =
  'min-h-9 w-full rounded-md border border-light-divider bg-light-surface px-2.5 py-1.5 text-[14px] text-light-text caret-light-accent-500 hover:border-light-text/45 focus-visible:border-light-accent-500 focus-visible:outline-none'
export const kicker = 'text-[10.5px] font-medium uppercase leading-none tracking-[.16em] text-light-accent-300'
export const pageShell =
  'grid flex-1 place-items-center overflow-y-auto bg-light-bg bg-[radial-gradient(900px_480px_at_30%_0%,#f3f7e2,transparent_70%)] p-8'

export function Tag({ tone, size = 11, children }: { tone: 'accent' | 'neutral'; size?: number; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-[6px] px-2.5 py-[3px] tracking-[.02em]',
        tone === 'accent' ? 'bg-light-accent-800 text-light-accent-100' : 'bg-light-neutral-800 text-light-neutral-100',
      )}
      style={{ fontSize: size }}
    >
      {children}
    </span>
  )
}

export function BackLink({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex items-center gap-[5px] border-0 bg-transparent p-0 text-[12px] text-light-neutral-500 hover:text-light-text', className)}
    >
      <ArrowLeft size={13} />
      Trocar tipo de conexão
    </button>
  )
}

export function NumberedSteps({ items }: { items: string[] }) {
  return (
    <ol className="mt-[22px] flex flex-col gap-3.5">
      {items.map((t, i) => (
        <li key={t} className="flex items-start gap-3">
          <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-pill border border-light-accent-700 bg-light-accent-900 text-[12px] font-medium leading-none text-light-accent-200">
            {i + 1}
          </span>
          <span className="pt-[3px] text-[13px] leading-[1.45]">{t}</span>
        </li>
      ))}
    </ol>
  )
}

const MATRIX = buildQrMatrix()

/** Caixa do QR 280x280. Sem `src` desenha o QR ilustrativo do protótipo (grade 25x25). */
export function QrBox({ src, overlay }: { src?: string; overlay?: string | null }) {
  // O QR real (Evolution) ocupa todo o espaço: o logo só entra sobre o desenho ilustrativo (tem buraco central).
  const showLogo = !src || src.startsWith('data:image/svg+xml')
  return (
    <div className="relative h-[280px] w-[280px] rounded-lg border border-light-divider bg-light-surface p-[18px]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="QR code para conectar o WhatsApp"
          className={cn('h-full w-full transition-opacity duration-300', overlay ? 'opacity-25' : 'opacity-100')}
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div
          className={cn('grid h-full w-full transition-opacity duration-300', overlay ? 'opacity-25' : 'opacity-100')}
          style={{ gridTemplateColumns: `repeat(${QR_SIZE}, 1fr)` }}
          aria-hidden
        >
          {MATRIX.flatMap((row, r) =>
            row.map((on, c) => <div key={`${r}-${c}`} className={cn('rounded-[1px]', on ? 'bg-light-text' : 'bg-transparent')} />),
          )}
        </div>
      )}
      {showLogo && (
        <div className="absolute left-1/2 top-1/2 -ml-[22px] -mt-[22px] grid h-11 w-11 place-items-center rounded-[10px] border border-light-divider bg-light-surface">
          <Leaf size={20} weight="fill" className="text-light-accent-400" />
        </div>
      )}
      {overlay && (
        <div className="absolute inset-0 flex animate-zfIn flex-col items-center justify-center gap-3 rounded-lg bg-light-surface/80">
          <span className="inline-block h-[30px] w-[30px] animate-zfSpin rounded-full border-2 border-light-accent-400 border-t-transparent" />
          <span className="text-[13px] font-medium leading-none">{overlay}</span>
        </div>
      )}
    </div>
  )
}

export function QrStatusLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-[7px] w-[7px] animate-zfPulse rounded-full bg-light-accent-400" />
      <span className="text-[12px] text-light-neutral-400">{children}</span>
    </div>
  )
}
