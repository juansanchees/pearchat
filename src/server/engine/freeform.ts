import { getProvider } from '@/server/whatsapp'
import type { ContactRef } from '@/server/whatsapp'
import type { ConnectedSession } from './util'

/** Pode mandar texto livre a este contato? (oficial: janela de 24 h aberta; rápida: sempre). */
export function canSendFreeformTo(session: ConnectedSession, to: ContactRef): Promise<boolean> {
  return getProvider(session.kind).canSendFreeform(session.workspaceId, to)
}
