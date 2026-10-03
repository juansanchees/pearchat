'use client'
import { useState } from 'react'
import type { ProviderKind } from '@/lib/types'
import { Chooser } from './chooser'
import { OficialFlow } from './oficial-flow'
import { RapidaFlow } from './rapida-flow'

// Cada fluxo é um componente próprio: ao trocar de tipo ele desmonta e cancela timers, polling e listeners.
export function ConnectWhatsApp() {
  const [provider, setProvider] = useState<ProviderKind | null>(null)
  if (provider === 'oficial') return <OficialFlow onBack={() => setProvider(null)} />
  if (provider === 'rapida') return <RapidaFlow onBack={() => setProvider(null)} />
  return <Chooser onPick={setProvider} />
}
