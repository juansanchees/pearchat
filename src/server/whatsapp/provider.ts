import type { ConnectionStatusKind } from '@/lib/types'

export type ContactRef = { waUserId?: string; telefone?: string }

/** Mídia a enviar. `data` já foi validada (tipo pela assinatura do arquivo e tamanho). */
export type OutboundMedia = {
  type: 'image' | 'video' | 'document' | 'audio'
  mime: string
  fileName: string
  caption?: string
  data: Buffer
}

/** Mídia baixada do provedor (mensagem recebida). */
export type FetchedMedia = { data: Buffer; mime?: string; fileName?: string }

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
  /** Opcional: envia imagem, vídeo ou documento (com legenda). */
  sendMedia?(workspaceId: string, to: ContactRef, media: OutboundMedia): Promise<{ providerMessageId: string }>
  /** Opcional: envia áudio como mensagem de voz. */
  sendAudio?(workspaceId: string, to: ContactRef, media: OutboundMedia): Promise<{ providerMessageId: string }>
  /**
   * Opcional: URL da foto de perfil do contato (null = sem foto ou privada). A URL expira: o chamador baixa a imagem na hora
   * (src/server/contacts/photo.ts). A API oficial não entrega foto de cliente: não implementa.
   */
  fetchProfilePicture?(workspaceId: string, contact: ContactRef): Promise<string | null>
  /** Opcional: baixa a mídia de uma mensagem recebida, SÓ pelo provedor configurado (nunca por URL vinda do webhook). */
  fetchMedia?(
    workspaceId: string,
    ref: { providerMessageId: string; remoteJid?: string; providerMediaId?: string; maxBytes: number },
  ): Promise<FetchedMedia>
}

/** O provedor ainda não envia esse recurso (ex.: mídia na API oficial). */
export class ProviderUnsupportedError extends Error {
  constructor(message = 'Este recurso ainda não é suportado por esta conexão') {
    super(message)
    this.name = 'ProviderUnsupportedError'
  }
}

/**
 * Erro HTTP de um provedor. `body` pode conter dados do provedor: não logue por inteiro.
 * `uncertain` = o pedido pode ter sido ACEITO pelo provedor (timeout depois de enviar, conexão caiu no meio, resposta 2xx
 * ilegível): o envio NÃO pode ser repetido às cegas; a mensagem fica "incerta" até a reconciliação (engine/delivery.ts).
 */
export class WhatsAppProviderError extends Error {
  public uncertain = false
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = 'WhatsAppProviderError'
  }
}

/** Marca o erro como "o provedor pode ter aceitado" (ver WhatsAppProviderError.uncertain). */
export function uncertainError(message: string, status = 0): WhatsAppProviderError {
  const e = new WhatsAppProviderError(message, status, null)
  e.uncertain = true
  return e
}

export const isUncertainSendError = (e: unknown): boolean => e instanceof WhatsAppProviderError && e.uncertain

/** API oficial: mais de 24 h desde a última mensagem do cliente (erro 131047 da Meta). Só um modelo aprovado pode ser enviado. */
export class WindowClosedError extends WhatsAppProviderError {
  constructor(body: unknown = null) {
    super('Fora da janela de 24 h só modelos aprovados podem ser enviados', 400, body)
    this.name = 'WindowClosedError'
  }
}
