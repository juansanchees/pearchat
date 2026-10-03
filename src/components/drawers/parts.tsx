'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CrownSimple, GearSix, LockSimple, PaperPlaneTilt, Sparkle, ClockClockwise, Warning, X } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { DrawerKey } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAppState } from '@/components/app/app-state'
import { DRAWER_DESCRIPTIONS, DRAWER_TITLES } from '@/components/app/automations'
import { PearSwitch } from '@/components/pear'

const HEAD_ICONS: Record<DrawerKey, Icon> = {
  ia: Sparkle,
  disparos: PaperPlaneTilt,
  followup: ClockClockwise,
  config: GearSix,
  plano: CrownSimple,
}

/** Casca comum dos drawers: cabeçalho, faixa de bloqueio, corpo rolável e rodapé. */
export function DrawerShell({ id, footer, children, loading }: { id: DrawerKey; footer: ReactNode; children: ReactNode; loading?: boolean }) {
  const { connected, automations, setAutomation, closeDrawer } = useAppState()
  const router = useRouter()
  const Ico = HEAD_ICONS[id]
  const isAuto = id === 'ia' || id === 'disparos' || id === 'followup'
  const locked = isAuto && !connected
  const showToggle = isAuto && connected

  return (
    <>
      <div
        onClick={closeDrawer}
        aria-hidden
        className="fixed inset-0 z-40 bg-[color-mix(in_srgb,#1d2117_30%,transparent)]"
        style={{ animation: 'zfFade .2s ease both' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={DRAWER_TITLES[id]}
        className="fixed bottom-0 right-0 top-0 z-[41] flex w-[min(540px,94vw)] animate-zfDrawer flex-col border-l border-light-divider bg-light-surface text-[13.5px] text-light-text shadow-drawer"
      >
        <header className="flex items-center gap-[13px] border-b border-light-divider px-[22px] py-[18px]">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[11px] border border-light-accent-700 bg-light-accent-900">
            <Ico size={19} className="text-light-accent-300" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[16px] font-medium leading-[1.2]">{DRAWER_TITLES[id]}</h2>
            <div className="mt-[3px] text-[12px] text-light-neutral-500">{DRAWER_DESCRIPTIONS[id]}</div>
          </div>
          {locked && (
            <span className="inline-flex flex-none items-center gap-[5px] rounded-pill border border-dashed border-light-neutral-700 px-[10px] py-1 text-[11.5px] text-light-neutral-500">
              <LockSimple size={12} />
              Bloqueado
            </span>
          )}
          {showToggle && (
            <PearSwitch
              checked={automations[id as 'ia' | 'disparos' | 'followup']}
              label="Ligar ou desligar"
              onChange={(next) => void setAutomation(id as 'ia' | 'disparos' | 'followup', next)}
            />
          )}
          <button type="button" onClick={closeDrawer} aria-label="Fechar" className="pc-btn pc-btn-ghost h-[34px] w-[34px] flex-none !p-0">
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-[22px]">
          {locked && (
            <div className="flex items-center gap-3 rounded-md border border-light-accent-700 bg-light-accent-900 px-[14px] py-3">
              <LockSimple size={17} className="flex-none text-light-accent-300" />
              <span className="flex-1 text-[12.5px] text-light-accent-200">Você pode configurar tudo agora. Para ligar, conecte o WhatsApp.</span>
              <button
                type="button"
                className="pc-btn pc-btn-primary !px-[11px] !py-[5px] !text-[12px] whitespace-nowrap"
                onClick={() => {
                  closeDrawer()
                  router.push('/whatsapp')
                }}
              >
                Conectar
              </button>
            </div>
          )}
          {loading ? <DrawerSkeleton /> : children}
        </div>

        <footer className="flex items-center justify-end gap-[10px] border-t border-light-divider px-[22px] py-[14px]">{footer}</footer>
      </div>
    </>
  )
}

/** Esqueleto exibido no corpo do drawer enquanto os dados carregam. */
function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Carregando">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse flex-col gap-[10px]">
          <div className="h-[10px] w-[90px] rounded-pill bg-light-neutral-900" />
          <div className="h-[38px] rounded-md bg-light-neutral-900" />
          <div className="h-[38px] w-4/5 rounded-md bg-light-neutral-900" />
        </div>
      ))}
    </div>
  )
}

/**
 * Rodapé padrão: Fechar + Salvar. `onSave` grava no servidor e lança Error se falhar:
 * então o drawer continua aberto e aparece um toast de erro. Sucesso fecha e mostra "Configurações salvas".
 */
export function SaveFooter({ titulo, onSave, disabled }: { titulo: string; onSave: () => Promise<void>; disabled?: boolean }) {
  const { closeDrawer, toast } = useAppState()
  const [saving, setSaving] = useState(false)
  const salvar = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave()
      closeDrawer()
      toast({ icon: <Check size={18} weight="fill" />, title: 'Configurações salvas', text: titulo })
    } catch (e) {
      toast({
        icon: <Warning size={18} weight="fill" />,
        title: 'Não foi possível salvar',
        text: e instanceof Error ? e.message : 'Tente novamente em instantes.',
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <button type="button" className="pc-btn pc-btn-ghost" onClick={closeDrawer}>
        Fechar
      </button>
      <button type="button" className="pc-btn pc-btn-primary disabled:opacity-60" disabled={saving || disabled} onClick={() => void salvar()}>
        <Check size={14} />
        Salvar
      </button>
    </>
  )
}

export function Section({ label, aside, children, gap = 'gap-[10px]' }: { label: string; aside?: ReactNode; children: ReactNode; gap?: string }) {
  return (
    <section className={cn('flex flex-col', gap)}>
      <div className="flex items-center justify-between">
        <span className="pc-section-label">{label}</span>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="pc-label">{label}</label>
      {children}
    </div>
  )
}

/** Segmentado (.seg do protótipo). */
export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="pc-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className="pc-seg-opt" aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** Opção em rádio (listas, modelos). */
export function RadioCard({
  selected,
  onClick,
  children,
  disabled,
  className,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border px-[14px] py-3 text-left',
        selected ? 'border-light-accent-600 bg-light-accent-900' : 'border-light-divider bg-transparent',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span
        className={cn(
          'grid h-4 w-4 flex-none place-items-center rounded-pill border',
          selected ? 'border-light-accent-400' : 'border-light-neutral-700',
        )}
      >
        <span className={cn('h-2 w-2 rounded-pill', selected ? 'bg-light-accent-400' : 'bg-transparent')} />
      </span>
      {children}
    </button>
  )
}

export function ProgressBar({ pct, onAccent }: { pct: number; onAccent?: boolean }) {
  return (
    <div className={cn('h-[6px] rounded-pill', onAccent ? 'bg-light-surface' : 'bg-light-neutral-900')}>
      <div
        className="h-full rounded-pill bg-[linear-gradient(90deg,#b3ca52,#86a028)] transition-[width] [transition-duration:400ms] ease-out"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  )
}

export function ChatBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto w-fit max-w-[90%] rounded-[14px_14px_4px_14px] border border-light-accent-700 bg-light-accent-900 px-[13px] py-[9px] text-[13px] leading-[1.45]">
      {children}
    </div>
  )
}
