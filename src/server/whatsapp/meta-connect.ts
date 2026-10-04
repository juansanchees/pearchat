import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { WhatsAppStatusDTO } from '@/lib/types'
import { logError } from '@/server/engine/util'
import {
  fetchBusinessToken,
  fetchPhoneInfo,
  listPhoneNumbers,
  newPin,
  registerPhone,
  requestSmbSync,
  subscribeApp,
} from './cloud-api'
import { oficialAllowedFor } from './config'
import type { PhoneInfo } from './cloud-api'
import { isGraphError } from './graph'
import { mergeSessionData, readSessionData, setStatus, toStatusDTO } from './session'
import { syncTemplates } from './templates'

// Orquestração da conexão oficial (Cadastro incorporado): estado de uso único, conclusão e Coexistence.

export class ConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ConnectError'
  }
}

const STATE_TTL_MS = 30 * 60_000

/** O usuário pode conectar a API oficial? (Meta configurada + beta liberado para o e-mail dele). */
export async function assertOficialAllowed(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || !oficialAllowedFor(user.email)) {
    throw new ConnectError('A conexão oficial estará disponível em breve. Use a conexão rápida por QR.', 409)
  }
}

/** Nonce de uso único ligado ao usuário e ao workspace que iniciou o cadastro (mesmo padrão do OAuth da agenda). */
export async function createSignupState(workspaceId: string, userId: string, mode: 'sdk' | 'hosted'): Promise<{ id: string; expiraEm: Date }> {
  const id = randomBytes(24).toString('base64url')
  const expiraEm = new Date(Date.now() + STATE_TTL_MS)
  await db.metaSignupState.create({ data: { id, workspaceId, userId, mode, expiraEm } })
  // Limpeza oportunista dos vencidos.
  await db.metaSignupState.deleteMany({ where: { expiraEm: { lt: new Date(Date.now() - 24 * 3_600_000) } } }).catch(() => {})
  return { id, expiraEm }
}

/** Consome o state (uma vez só). false = inexistente, de outro usuário/workspace, vencido ou já usado. */
export async function consumeSignupState(id: string, workspaceId: string, userId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return false
  const r = await db.metaSignupState.updateMany({
    where: { id, workspaceId, userId, usedAt: null, expiraEm: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  return r.count === 1
}

/** Confere (sem consumir) que o state é válido para este usuário/workspace (e, se pedido, do modo certo); devolve a hora de criação. */
export async function peekSignupState(id: string, workspaceId: string, userId: string, mode?: 'sdk' | 'hosted'): Promise<Date | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null
  const row = await db.metaSignupState.findFirst({ where: { id, workspaceId, userId, usedAt: null, expiraEm: { gt: new Date() }, ...(mode ? { mode } : {}) } })
  return row ? row.createdAt : null
}

/**
 * Quantos workspaces tinham um cadastro hospedado ABERTO (não usado, não vencido) criado antes de `eventAt`.
 * Se for mais de um, não dá para saber de quem é o evento da Meta: ninguém o reivindica automaticamente.
 */
export async function countHostedCandidates(eventAt: Date): Promise<number> {
  const rows = await db.metaSignupState.findMany({
    where: { mode: 'hosted', usedAt: null, expiraEm: { gt: new Date() }, createdAt: { lte: eventAt } },
    select: { workspaceId: true },
    distinct: ['workspaceId'],
    take: 5,
  })
  return rows.length
}

export type CompleteInput = {
  workspaceId: string
  token: string
  wabaId: string
  /** Se o navegador informou; precisa pertencer à WABA do token. */
  phoneNumberId?: string
  businessId?: string
  /** true = número que continua no app WhatsApp Business (já registrado: NÃO registrar). */
  coexistence: boolean
  /** Hospedado: não sabemos o tipo; só registra se o número ainda não estiver conectado. */
  registerUnlessConnected?: boolean
}

/**
 * Conclui a conexão: valida o número contra a WABA do token, garante que nenhum outro workspace o usa, assina o app,
 * registra o número quando necessário, lê os dados exibidos e grava a sessão como CONECTADA.
 */
export async function completeConnection(input: CompleteInput): Promise<WhatsAppStatusDTO> {
  const { workspaceId, token, wabaId } = input
  let phones: PhoneInfo[]
  try {
    phones = await listPhoneNumbers(wabaId, token)
  } catch (e) {
    if (isGraphError(e)) {
      logError('meta', `não leu os números da WABA (${e.toLog()})`, e)
      // 4xx = o token não enxerga esta WABA.
      if (e.status >= 400 && e.status < 500) throw new ConnectError('Não foi possível acessar essa conta do WhatsApp na Meta', 403)
    }
    throw new ConnectError('Não foi possível concluir a conexão com a Meta', 502)
  }

  let phone: PhoneInfo | undefined
  if (input.phoneNumberId) {
    phone = phones.find((p) => p.id === input.phoneNumberId)
    if (!phone) throw new ConnectError('Número não pertence à conta informada', 403)
  } else {
    // Coexistence só informa a WABA: usa o único número, ou o único ainda livre.
    const used = await db.whatsAppSession.findMany({ where: { metaPhoneNumberId: { in: phones.map((p) => p.id) }, workspaceId: { not: workspaceId } }, select: { metaPhoneNumberId: true } })
    const free = phones.filter((p) => !used.some((u) => u.metaPhoneNumberId === p.id))
    if (phones.length === 0) throw new ConnectError('Nenhum número encontrado nessa conta do WhatsApp', 422)
    if (free.length === 0) throw new ConnectError('Esse número já está conectado a outro workspace', 409)
    if (free.length > 1) throw new ConnectError('Há mais de um número nessa conta; refaça o cadastro escolhendo apenas um', 422)
    phone = free[0]
  }
  if (!phone) throw new ConnectError('Número não encontrado', 422)

  const taken = await db.whatsAppSession.findFirst({ where: { metaPhoneNumberId: phone.id, workspaceId: { not: workspaceId } }, select: { id: true } })
  if (taken) throw new ConnectError('Esse número já está conectado a outro workspace', 409)

  try {
    await subscribeApp(wabaId, token)
  } catch (e) {
    if (isGraphError(e)) logError('meta', `subscribed_apps falhou (${e.toLog()})`, e)
    throw new ConnectError('A Meta não aceitou assinar os avisos desta conta. Tente novamente.', 502)
  }

  // Registro na Cloud API: nunca em número da Coexistence (já registrado pelo app e o registro desfaria o vínculo).
  let pin: string | undefined
  const needRegister = !input.coexistence && (!input.registerUnlessConnected || phone.status !== 'CONNECTED')
  if (needRegister) {
    pin = newPin()
    try {
      await registerPhone(phone.id, token, pin)
    } catch (e) {
      if (isGraphError(e)) logError('meta', `register falhou (${e.toLog()})`, e)
      // Já registrado/conectado antes: segue; senão, falha a conexão.
      const info = await fetchPhoneInfo(phone.id, token)
      if (info?.status !== 'CONNECTED') throw new ConnectError('Não foi possível registrar o número na Meta. Tente novamente.', 502)
      pin = undefined
    }
  }

  const info = (await fetchPhoneInfo(phone.id, token)) ?? phone
  const current = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { numero: true } })
  const sessionData = await mergeSessionData(workspaceId, { accessToken: token, ...(pin ? { pin } : {}) })
  let row
  try {
    row = await setStatus(workspaceId, 'conectado', {
      provider: 'oficial',
      numero: info.displayPhone ?? phone.displayPhone ?? current?.numero ?? null,
      metaPhoneNumberId: phone.id,
      metaWabaId: wabaId,
      evolutionInstance: null,
      sessionData,
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConnectError('Esse número já está conectado a outro workspace', 409)
    throw e
  }
  row = await db.whatsAppSession.update({
    where: { workspaceId },
    data: {
      metaBusinessId: input.businessId ?? null,
      metaVerifiedName: info.verifiedName ?? null,
      metaQuality: info.quality ?? null,
      metaCoexistence: input.coexistence,
      metaLastError: null,
    },
  })
  // Modelos já existentes na conta: traz para o PearChat sem travar a conexão.
  void syncTemplates(workspaceId, { force: true }).catch((e) => logError('meta', 'sincronização inicial de modelos falhou', e))
  return toStatusDTO(row)
}

/** Passo final do fluxo: grava a escolha de importar o histórico e, na Coexistence, pede à Meta os dados do app. */
export async function applyHistoryChoice(workspaceId: string, importar: boolean): Promise<void> {
  const row = await db.whatsAppSession.findUnique({ where: { workspaceId } })
  const sessionData = await mergeSessionData(workspaceId, { importarHistorico: importar })
  await db.whatsAppSession.update({ where: { workspaceId }, data: { sessionData } })
  if (!importar || !row || row.provider !== 'OFICIAL' || !row.metaCoexistence || !row.metaPhoneNumberId) return
  const token = (await readSessionData(workspaceId)).accessToken
  if (!token) return
  try {
    // Contatos e histórico: a Meta responde pelos webhooks smb_app_state_sync e history (janela de 24 h do cadastro).
    await requestSmbSync(row.metaPhoneNumberId, token, ['smb_app_state_sync', 'history'])
  } catch (e) {
    if (isGraphError(e)) logError('meta', `pedido de histórico falhou (${e.toLog()})`, e)
    else logError('meta', 'pedido de histórico falhou', e)
  }
}

/** Fluxo hospedado: token do negócio + conclusão. Usado quando o usuário reivindica um cadastro (PARTNER_ADDED). */
export async function completeHosted(workspaceId: string, wabaId: string, businessId: string, phoneNumberId?: string): Promise<WhatsAppStatusDTO> {
  let token: string
  try {
    token = await fetchBusinessToken(businessId)
  } catch (e) {
    if (isGraphError(e)) logError('meta', `token do negócio falhou (${e.toLog()})`, e)
    else logError('meta', 'token do negócio falhou', e)
    throw new ConnectError('Não foi possível obter o acesso à conta na Meta', 502)
  }
  return completeConnection({ workspaceId, token, wabaId, businessId, phoneNumberId, coexistence: false, registerUnlessConnected: true })
}
