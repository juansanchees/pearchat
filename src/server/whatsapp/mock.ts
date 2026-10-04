import { randomUUID } from 'node:crypto'
import { statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind } from '@/lib/types'
import { updateMessageStatus } from '@/server/messages/ingest'
import { buildQrSvgDataUrl } from './mock-qr'
import type { ContactRef, FetchedMedia, OutboundMedia, WhatsAppProvider } from './provider'
import { WhatsAppProviderError } from './provider'
import { getSession } from './session'

/**
 * Mídias "no celular do cliente" do modo demo: o endpoint de teste /api/dev/inbound registra o arquivo aqui e o
 * download passa pelo MESMO caminho da Evolution (fetchMedia). `failTimes` simula falhas do download.
 */
type MockFixture = { data: Buffer; mime?: string; fileName?: string; failTimes: number }
const gm = globalThis as unknown as { __pearchat_mock_media?: Map<string, MockFixture> }
const fixtures = (gm.__pearchat_mock_media ??= new Map<string, MockFixture>())
export function registerMockMedia(providerMessageId: string, fx: MockFixture): void {
  fixtures.set(providerMessageId, fx)
}

export const MOCK_NUMERO = '+55 11 98765-4321'

// Provedor de mentira (WA_MOCK=true): navega o app sem Evolution nem Meta.
// A "leitura do QR" acontece em POST /api/wa/mock/scan.
export class MockProvider implements WhatsAppProvider {
  async connect(): Promise<{ qr?: string }> {
    return { qr: buildQrSvgDataUrl() }
  }

  async status(workspaceId: string): Promise<ConnectionStatusKind> {
    const row = await getSession(workspaceId)
    return row ? statusToKind(row.status) : 'desconectado'
  }

  async sendText(workspaceId: string, _to: ContactRef, _text: string): Promise<{ providerMessageId: string }> {
    const providerMessageId = `mock_${randomUUID()}`
    setTimeout(() => {
      updateMessageStatus({ workspaceId, providerMessageId, status: 'entregue' }).catch(() => {
        // mock: falha na simulação não deve derrubar o processo
      })
    }, 1500)
    return { providerMessageId }
  }

  private fakeSend(workspaceId: string): { providerMessageId: string } {
    const providerMessageId = `mock_${randomUUID()}`
    setTimeout(() => {
      updateMessageStatus({ workspaceId, providerMessageId, status: 'entregue' }).catch(() => {})
    }, 1500)
    return { providerMessageId }
  }

  async sendMedia(workspaceId: string, _to: ContactRef, _media: OutboundMedia): Promise<{ providerMessageId: string }> {
    return this.fakeSend(workspaceId)
  }

  async sendAudio(workspaceId: string, _to: ContactRef, _media: OutboundMedia): Promise<{ providerMessageId: string }> {
    return this.fakeSend(workspaceId)
  }

  async fetchMedia(_workspaceId: string, ref: { providerMessageId: string; maxBytes: number }): Promise<FetchedMedia> {
    const fx = fixtures.get(ref.providerMessageId)
    if (!fx) throw new WhatsAppProviderError('Mídia não encontrada no provedor', 404, null)
    if (fx.failTimes > 0) {
      fx.failTimes--
      throw new WhatsAppProviderError('Falha simulada do download', 502, null)
    }
    if (fx.data.length > ref.maxBytes) throw new WhatsAppProviderError('Mídia grande demais', 413, null)
    return { data: fx.data, mime: fx.mime, fileName: fx.fileName }
  }

  async sendTemplate(workspaceId: string, to: ContactRef, _templateName: string, _vars: string[]) {
    return this.sendText(workspaceId, to, '')
  }

  async canSendFreeform(): Promise<boolean> {
    return true
  }

  async disconnect(): Promise<void> {
    return
  }
}
