import { Info } from '@/components/site/ui/icons'

// Aviso de cobrança da página inicial. Fica sozinho de propósito: quando a cobrança começar, troque só o texto aqui.
export const BILLING_NOTICE = 'A cobrança ainda não está ativa: durante o lançamento, o uso é gratuito.'

export function PricingNotice() {
  return (
    <p className="mx-auto mt-8 flex max-w-[640px] items-start gap-2 rounded-lg border border-amber-border bg-amber-bg px-4 py-3 text-[13.5px] leading-[1.5] text-amber-text">
      <Info size={18} className="mt-px flex-none" aria-hidden="true" />
      <span>{BILLING_NOTICE}</span>
    </p>
  )
}
