'use client'
import { useAppState } from '@/components/app/app-state'
import { MenuButton } from '@/components/app/menu-button'
import Conversas from '@/components/conversas/conversas'
import { ConnectWhatsApp } from './connect-whatsapp'

export function WhatsAppView() {
  const { connected } = useAppState()
  if (connected) return <Conversas />
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra mínima para abrir o menu quando ele vira gaveta (< 900 px). */}
      <div className="flex h-12 flex-none items-center gap-3 border-0 border-b border-solid border-light-divider bg-light-surface px-3 min-[900px]:hidden">
        <MenuButton />
        <span className="text-[14.5px] font-medium">WhatsApp</span>
      </div>
      <ConnectWhatsApp />
    </div>
  )
}
