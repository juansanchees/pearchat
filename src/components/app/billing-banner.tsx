'use client'

import { useEffect, useState } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { useAppState } from './app-state'
import { usePermissions } from './use-permissions'

type Estado = { ativo: boolean; status?: string; restrito?: boolean; motivo?: string | null; trialDias?: number | null }

// Faixa discreta (mesmo padrão da faixa "Sem conexão"): teste acabando, pagamento em atraso ou conta em modo restrito.
// Sem cobrança ligada (padrão) a rota devolve { ativo: false } e nada aparece.
export function BillingBanner() {
  const { openDrawer } = useAppState()
  const { isOwner } = usePermissions()
  const [s, setS] = useState<Estado | null>(null)

  useEffect(() => {
    let vivo = true
    const carregar = () =>
      fetch('/api/billing/status', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<Estado>) : null))
        .then((d) => vivo && d && setS(d))
        .catch(() => undefined)
    void carregar()
    const t = window.setInterval(carregar, 5 * 60_000)
    return () => {
      vivo = false
      window.clearInterval(t)
    }
  }, [])

  if (!s?.ativo || s.status === 'isenta') return null
  let texto: string | null = null
  if (s.restrito) {
    texto = 'Assinatura inativa: a IA, o follow-up e os disparos estão pausados. Suas mensagens continuam chegando e você pode responder normalmente.'
  } else if (s.status === 'atrasada') {
    texto = 'Pagamento em atraso. Regularize para não pausar a IA, o follow-up e os disparos.'
  } else if ((s.status === 'trial' || s.status === 'pendente') && s.trialDias != null && s.trialDias <= 7) {
    texto = s.trialDias <= 0 ? 'Seu teste termina hoje.' : `Teste grátis: ${s.trialDias === 1 ? 'falta 1 dia' : `faltam ${s.trialDias} dias`}.`
  }
  if (!texto) return null

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-0 border-b border-solid border-amber-border bg-amber-bg px-4 py-1.5 text-center text-[12px] leading-tight text-amber-text"
    >
      <WarningCircle size={14} className="flex-none" />
      <span>{texto}</span>
      {isOwner ? (
        <button type="button" className="border-0 bg-transparent p-0 text-[12px] text-amber-text underline" onClick={() => openDrawer('plano')}>
          Ver plano e pagamento
        </button>
      ) : s.restrito || s.status === 'atrasada' ? (
        <span>Fale com o dono da conta.</span>
      ) : null}
    </div>
  )
}
