import type { ConnectionStatusKind } from '@/lib/types'

export type ContactRef = { waUserId?: string; telefone?: string }

// Interface comum aos dois provedores (API Oficial e Evolution). Veja WHATSAPP_INTEGRACAO.md, seção 2.
export interface WhatsAppProvider {
  connect(workspaceId: string): Promise<{ qr?: string; signupUrl?: string }>
  status(workspaceId: string): Promise<ConnectionStatusKind>
  sendText(workspaceId: string, to: ContactRef, text: string): Promise<{ providerMessageId: string }>
  sendTemplate?(
    workspaceId: string,
    to: ContactRef,
    templateName: string,
    vars: string[],
  ): Promise<{ providerMessageId: string }>
  /** Oficial: janela de 24h aberta? Rápida: sempre true. */
  canSendFreeform(workspaceId: string, contact: ContactRef): Promise<boolean>
  disconnect(workspaceId: string): Promise<void>
  /** Opcional: pede um QR novo sem recriar a sessão (Evolution). */
  refreshQr?(workspaceId: string): Promise<string | undefined>
  /** Opcional: número conectado, quando o provedor sabe informar (Evolution). */
  fetchNumero?(workspaceId: string): Promise<string | undefined>
}

/** Erro HTTP de um provedor. `body` pode conter dados do provedor: não logue por inteiro. */
export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'WhatsAppProviderError'
  }
}
