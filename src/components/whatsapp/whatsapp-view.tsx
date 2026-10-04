'use client'
import { useAppState } from '@/components/app/app-state'
import { MenuButton } from '@/components/app/menu-button'
import Conversas from '@/components/conversas/conversas'
import { ConnectWhatsApp } from './connect-whatsapp'
import { NumberMenu } from './number-menu'

export function WhatsAppView() {
  const { connected, user } = useAppState()
  if (connected) return <Conversas />
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra superior da tela de conexão: título do WhatsApp deste espaço + menu do número (e o botão do menu lateral abaixo de 900 px). */}
      <div className="flex h-14 flex-none items-center gap-3.5 border-0 border-b border-solid border-light-divider bg-light-surface px-5 max-[899px]:px-3">
        <MenuButton />
        <div className="min-w-0">
          <div className="text-[14.5px] font-medium leading-tight">WhatsApp</div>
          <div className="truncate text-[11px] text-light-neutral-500">{user.empresa}</div>
        </div>
        <NumberMenu />
      </div>
      <ConnectWhatsApp />
    </div>
  )
}
