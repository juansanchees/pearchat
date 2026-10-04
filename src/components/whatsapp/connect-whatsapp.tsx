'use client'
import { useState } from 'react'
import { useAppState } from '@/components/app/app-state'
import type { ProviderKind } from '@/lib/types'
import { Chooser } from './chooser'
import { OficialFlow } from './oficial-flow'
import { OficialRealFlow } from './oficial-real-flow'
import { RapidaFlow } from './rapida-flow'

// Cada fluxo é um componente próprio: ao trocar de tipo ele desmonta e cancela timers, polling e listeners.
export function ConnectWhatsApp() {
  const { connectCfg } = useAppState()
  const [provider, setProvider] = useState<ProviderKind | null>(null)
  // Fluxo oficial sem Meta configurada (e fora do demo) nunca abre: volta para a escolha.
  const oficialOk = connectCfg.demo || connectCfg.oficialAtivo
  // Demo (WA_MOCK): fluxo simulado do protótipo. Fora do demo: Cadastro incorporado real da Meta.
  if (provider === 'oficial' && oficialOk) return connectCfg.demo ? <OficialFlow onBack={() => setProvider(null)} /> : <OficialRealFlow onBack={() => setProvider(null)} />
  if (provider === 'rapida') return <RapidaFlow onBack={() => setProvider(null)} />
  return <Chooser onPick={setProvider} />
}
