'use client'

import type { ReactNode } from 'react'
import { NotificationBell } from './notification-bell'

/**
 * Ponto único do sininho: envolve o conteúdo da tela (abaixo das faixas de aviso) e põe o sino no canto superior direito
 * da barra de 56 px que TODAS as telas internas têm. Reserva 52 px à direita do cabeçalho da tela (o primeiro filho do
 * conteúdo) para o sino nunca cobrir os controles que já existem (chips, "Novo contato", "Voltar às conversas"...).
 * É a única mudança de layout fora desta pasta: o AppShell só renderiza <NotificationSlot>{children}</NotificationSlot>.
 */
export function NotificationSlot({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col [&>*:not(:last-child)>*:first-child]:pr-[52px]">
      {children}
      <NotificationBell />
    </div>
  )
}
