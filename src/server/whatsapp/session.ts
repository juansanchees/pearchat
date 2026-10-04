import { Prisma } from '@prisma/client'
import type { ConnectionStatus, WhatsAppSession } from '@prisma/client'
import { db } from '@/lib/db'
import { kindToProvider, kindToStatus, providerToKind, statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind, ProviderKind, WhatsAppStatusDTO } from '@/lib/types'
import { setDisparosAtivos } from '@/server/campaigns/service'
import { emitToWorkspace } from '@/server/realtime/emit'
import { decrypt, encrypt } from './crypto'
import { scheduleInitialImport } from './history-import'

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
  if (row.provider === 'OFICIAL' && row.metaCoexistence) dto.coexistence = true
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
  /** Zera o andamento da importação de histórico (ao desconectar). */
  resetHistory?: boolean
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
    connectedAt?: Date | null
    historyStatus?: string
    historyStartedAt?: Date | null
    historyImportedAt?: Date | null
    historyStats?: Prisma.NullableJsonNullValueInput
    historyPasses?: number
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

  // Transição para CONECTADO = nova conexão: marca o instante e agenda a importação do histórico.
  let newConnection = false
  if (status === 'conectado') {
    const prev = await db.whatsAppSession.findUnique({
      where: { workspaceId },
      select: { status: true, connectedAt: true, historyStatus: true },
    })
    if (prev?.status !== 'CONECTADO' && (!prev?.connectedAt || Date.now() - prev.connectedAt.getTime() > 3_600_000)) {
      newConnection = true
      data.connectedAt = new Date()
      data.historyPasses = 0
      if (prev?.historyStatus !== 'importando') data.historyStatus = 'nao_iniciada'
    }
  }
  if (extra.resetHistory) {
    data.connectedAt = null
    data.historyStatus = 'nao_iniciada'
    data.historyStartedAt = null
    data.historyImportedAt = null
    data.historyStats = Prisma.JsonNull
    data.historyPasses = 0
  }

  const row = await db.whatsAppSession.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  })
  if (newConnection && row.provider === 'RAPIDA' && process.env.WA_MOCK !== 'true') scheduleInitialImport(workspaceId)
  const dto = toStatusDTO(row)
  emitToWorkspace(workspaceId, 'connection.update', {
    workspaceId,
    status: dto.status,
    numero: dto.numero,
    ...(dto.qr ? { qr: dto.qr } : {}),
  })
  return row
}

/** Desligar no servidor IA, follow-up e disparos (pausando campanhas) quando o WhatsApp cai; não depende do cliente. */
export async function disableAutomations(workspaceId: string): Promise<void> {
  await Promise.all([
    db.aiAgent.updateMany({ where: { workspaceId }, data: { enabled: false } }),
    db.followUpRule.updateMany({ where: { workspaceId }, data: { enabled: false } }),
    setDisparosAtivos(workspaceId, false),
  ])
}

// --- sessionData (JSON criptografado: token do workspace, preferências) ---
export type SessionData = {
  accessToken?: string
  importarHistorico?: boolean
  /** PIN de verificação em duas etapas (6 dígitos) usado no registro do número na Cloud API. */
  pin?: string
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
