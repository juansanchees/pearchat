import type { ConnectionStatus, WhatsAppSession } from '@prisma/client'
import { db } from '@/lib/db'
import { kindToProvider, kindToStatus, providerToKind, statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind, ProviderKind, WhatsAppStatusDTO } from '@/lib/types'
import { emitToWorkspace } from '@/server/realtime/emit'
import { decrypt, encrypt } from './crypto'

export function getSession(workspaceId: string): Promise<WhatsAppSession | null> {
  return db.whatsAppSession.findUnique({ where: { workspaceId } })
}

export function toStatusDTO(row: WhatsAppSession | null, qr?: string): WhatsAppStatusDTO {
  if (!row) return { provider: null, status: 'desconectado', numero: null }
  const status = statusToKind(row.status)
  const dto: WhatsAppStatusDTO = {
    provider: row.provider ? providerToKind(row.provider) : null,
    status,
    numero: row.numero,
  }
  const q = qr ?? (status === 'aguardando_qr' ? (row.lastQr ?? undefined) : undefined)
  if (q) dto.qr = q
  return dto
}

export async function getStatusDTO(workspaceId: string): Promise<WhatsAppStatusDTO> {
  return toStatusDTO(await getSession(workspaceId))
}

export type SessionExtra = {
  provider?: ProviderKind | null
  numero?: string | null
  /** string = grava o QR (e a hora); null = limpa. */
  qr?: string | null
  metaPhoneNumberId?: string | null
  metaWabaId?: string | null
  evolutionInstance?: string | null
  /** Valor já criptografado. */
  sessionData?: string | null
}

/** Grava o status no banco e avisa os clientes (evento connection.update). */
export async function setStatus(
  workspaceId: string,
  status: ConnectionStatusKind,
  extra: SessionExtra = {},
): Promise<WhatsAppSession> {
  const data: {
    status: ConnectionStatus
    provider?: ReturnType<typeof kindToProvider> | null
    numero?: string | null
    lastQr?: string | null
    lastQrAt?: Date | null
    metaPhoneNumberId?: string | null
    metaWabaId?: string | null
    evolutionInstance?: string | null
    sessionData?: string | null
  } = { status: kindToStatus(status) }
  if (extra.provider !== undefined) data.provider = extra.provider ? kindToProvider(extra.provider) : null
  if (extra.numero !== undefined) data.numero = extra.numero
  if (extra.qr !== undefined) {
    data.lastQr = extra.qr
    data.lastQrAt = extra.qr ? new Date() : null
  } else if (status !== 'aguardando_qr') {
    data.lastQr = null
    data.lastQrAt = null
  }
  if (extra.metaPhoneNumberId !== undefined) data.metaPhoneNumberId = extra.metaPhoneNumberId
  if (extra.metaWabaId !== undefined) data.metaWabaId = extra.metaWabaId
  if (extra.evolutionInstance !== undefined) data.evolutionInstance = extra.evolutionInstance
  if (extra.sessionData !== undefined) data.sessionData = extra.sessionData

  const row = await db.whatsAppSession.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  })
  const dto = toStatusDTO(row)
  emitToWorkspace(workspaceId, 'connection.update', {
    workspaceId,
    status: dto.status,
    numero: dto.numero,
    ...(dto.qr ? { qr: dto.qr } : {}),
  })
  return row
}

// --- sessionData (JSON criptografado: token do workspace, preferências) ---
export type SessionData = {
  accessToken?: string
  importarHistorico?: boolean
}

export async function readSessionData(workspaceId: string): Promise<SessionData> {
  const row = await getSession(workspaceId)
  if (!row?.sessionData) return {}
  try {
    const parsed: unknown = JSON.parse(decrypt(row.sessionData))
    return parsed && typeof parsed === 'object' ? (parsed as SessionData) : {}
  } catch {
    return {}
  }
}

/** Devolve o novo sessionData (já criptografado) com `patch` somado ao atual. */
export async function mergeSessionData(workspaceId: string, patch: SessionData): Promise<string> {
  const current = await readSessionData(workspaceId)
  return encrypt(JSON.stringify({ ...current, ...patch }))
}
