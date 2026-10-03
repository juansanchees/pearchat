import { randomUUID } from 'node:crypto'
import { statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind } from '@/lib/types'
import { updateMessageStatus } from '@/server/messages/ingest'
import { buildQrSvgDataUrl } from './mock-qr'
import type { ContactRef, WhatsAppProvider } from './provider'
import { getSession } from './session'

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
