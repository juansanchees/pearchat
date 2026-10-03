'use client'
import { cn } from '@/lib/utils'

/**
 * Switch PearChat. `tone="dark"` para o menu lateral, `tone="light"` (padrão) para drawer e áreas claras.
 * sm = 38x22 (knob 16), md = 42x24 (knob 18).
 */
export function PearSwitch({
  checked,
  onChange,
  size = 'md',
  disabled,
  tone = 'light',
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  tone?: 'dark' | 'light'
  label?: string
}) {
  const sm = size === 'sm'
  const dark = tone === 'dark'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'relative shrink-0 rounded-pill border p-0 transition-[background-color,border-color] duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-[22px] w-[38px]' : 'h-6 w-[42px]',
        checked
          ? dark
            ? 'border-dark-accent-400 bg-dark-accent-500'
            : 'border-light-accent-400 bg-light-accent-500'
          : dark
            ? 'border-dark-neutral-700 bg-dark-neutral-900'
            : 'border-light-neutral-700 bg-light-neutral-900',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] rounded-pill transition-[left,background-color] [transition-duration:180ms] ease-out',
          sm ? 'h-4 w-4' : 'h-[18px] w-[18px]',
          checked ? (sm ? 'left-[18px]' : 'left-[20px]') : 'left-[2px]',
          checked ? 'bg-[#fbfcf3]' : dark ? 'bg-dark-neutral-500' : 'bg-light-neutral-500',
        )}
      />
    </button>
  )
}
