'use client'

import { CheckCircle } from '@phosphor-icons/react'
import { useAppState } from './app-state'

// Toast no canto inferior direito (spec 00 §7). Um por vez, some em 3,8 s (timer no AppStateProvider).
export function ToastHost() {
  const { currentToast: t } = useAppState()
  return (
    <div className="pointer-events-none fixed bottom-[22px] right-[22px] z-[60]" role="status" aria-live="polite">
      {t && (
        <div key={t.id} className="animate-zfToast">
          <div className="pointer-events-auto flex max-w-[380px] items-center gap-[11px] rounded-md bg-light-surface px-[15px] py-3 shadow-[0_0_0_1px_#9397ab,0_16px_40px_rgba(0,0,0,0.65)]">
            <span className="flex shrink-0 text-light-accent-400 [&>svg]:h-[18px] [&>svg]:w-[18px]">
              {t.icon ?? <CheckCircle weight="fill" size={18} />}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium leading-[1.2] text-light-text">{t.title}</div>
              {t.text && <div className="mt-[3px] text-[11.5px] text-light-neutral-500">{t.text}</div>}
            </div>
            {t.action && (
              <button type="button" className="pc-btn pc-btn-primary shrink-0 !text-[12px]" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
