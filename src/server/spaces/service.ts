import { z } from 'zod'
import { db } from '@/lib/db'
import { providerToKind, statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind, ProviderKind } from '@/lib/types'
import { ensureServiceTypes } from '@/server/calendar/service-types'
import { getProvider } from '@/server/whatsapp'
import { disableAutomations, setStatus } from '@/server/whatsapp/session'
import { userCanAccessSpace } from '@/server/team/access'
import { invalidateActiveSpace, PLAN_NAME, PLAN_SPACE_LIMIT } from './org'

export class SpaceError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}

export type SpaceDTO = {
  id: string
  nome: string
  ordem: number
  provider: ProviderKind | null
  status: ConnectionStatusKind
  numero: string | null
  /** Mensagens não lidas somadas em todas as conversas do espaço. */
  unread: number
  /** Pendências de atendimento: conversas em HUMANO com mensagens não lidas. */
  handoffs: number
  ativo: boolean
}

export type SpacesResponse = {
  espacos: SpaceDTO[]
  plano: 'Essencial' | 'Pro' | 'Negócios'
  limite: number
  usados: number
  ativoId: string
}

export const nomeSchema = z.string().trim().min(1, 'Informe o nome do negócio').max(120, 'Nome muito longo')
export const createSchema = z.object({ nome: nomeSchema })
export const switchSchema = z.object({ workspaceId: z.string().min(1).max(64) })
export const patchSchema = z
  .object({ nome: nomeSchema.optional(), ordem: z.number().int().min(0).max(1000).optional() })
  .refine((v) => v.nome !== undefined || v.ordem !== undefined, 'Nada para alterar')

const LIMIT_MSG = (n: number) => `Seu plano permite ${n} ${n === 1 ? 'WhatsApp' : 'WhatsApps'}`

/** `onlyIds` (Equipe): atendente enxerga só os espaços liberados para ele; null/undefined = todos da organização. */
export async function listSpaces(organizationId: string, activeWorkspaceId: string, onlyIds?: string[] | null): Promise<SpacesResponse> {
  const [org, rows] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plano: true } }),
    db.workspace.findMany({
      where: { organizationId, arquivadoEm: null, ...(onlyIds ? { id: { in: onlyIds } } : {}) },
      orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, nome: true, ordem: true, whatsappSession: { select: { provider: true, status: true, numero: true } } },
    }),
  ])
  const ids = rows.map((r) => r.id)
  const [unread, handoffs] = await Promise.all([
    db.conversation.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, unread: { gt: 0 } }, _sum: { unread: true } }),
    db.conversation.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, mode: 'HUMANO', unread: { gt: 0 } }, _count: { _all: true } }),
  ])
  const unreadBy = new Map(unread.map((g) => [g.workspaceId, g._sum.unread ?? 0]))
  const handoffBy = new Map(handoffs.map((g) => [g.workspaceId, g._count._all]))
  return {
    espacos: rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      ordem: r.ordem,
      provider: r.whatsappSession?.provider ? providerToKind(r.whatsappSession.provider) : null,
      status: r.whatsappSession ? statusToKind(r.whatsappSession.status) : 'desconectado',
      numero: r.whatsappSession?.numero ?? null,
      unread: unreadBy.get(r.id) ?? 0,
      handoffs: handoffBy.get(r.id) ?? 0,
      ativo: r.id === activeWorkspaceId,
    })),
    plano: PLAN_NAME[org.plano],
    limite: PLAN_SPACE_LIMIT[org.plano],
    usados: rows.length,
    ativoId: activeWorkspaceId,
  }
}

// Fila por organização dentro do processo: criações simultâneas esperam AQUI (sem segurar conexão do banco) em vez de
// esperarem dentro da transação; o lock consultivo continua valendo entre processos.
const createQueue = new Map<string, Promise<unknown>>()
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = createQueue.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  createQueue.set(key, tail)
  void tail.then(() => {
    if (createQueue.get(key) === tail) createQueue.delete(key)
  })
  return run
}

/** Cria o espaço (Workspace + agente + follow-up + tipos de atendimento genéricos), respeitando o limite do plano. */
export async function createSpace(organizationId: string, nome: string): Promise<{ id: string; nome: string }> {
  const created = await serialize(organizationId, () => createInTx(organizationId, nome))
  await ensureServiceTypes(created.id).catch(() => undefined)
  return created
}

async function createInTx(organizationId: string, nome: string): Promise<{ id: string; nome: string }> {
  return db.$transaction(async (tx) => {
    // Serializa criações simultâneas da mesma organização: sem isso duas abas furariam o limite.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'space:' + organizationId}))`
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plano: true, statusAssinatura: true } })
    const limite = PLAN_SPACE_LIMIT[org.plano]
    const atuais = await tx.workspace.count({ where: { organizationId, arquivadoEm: null } })
    if (atuais >= limite) throw new SpaceError(LIMIT_MSG(limite), 403, 'LIMITE_PLANO')
    const last = await tx.workspace.aggregate({ where: { organizationId }, _max: { ordem: true } })
    const ws = await tx.workspace.create({
      data: {
        nome,
        organizationId,
        plano: org.plano,
        statusAssinatura: org.statusAssinatura,
        ordem: (last._max.ordem ?? -1) + 1,
        aiAgent: { create: {} },
        followUpRule: { create: {} },
        whatsappSession: { create: {} },
      },
      select: { id: true, nome: true },
    })
    return ws
  })
}

/** Garante que o espaço existe, é da organização e não está arquivado. */
async function ownedSpace(organizationId: string, workspaceId: string) {
  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, organizationId },
    select: { id: true, nome: true, arquivadoEm: true },
  })
  if (!ws) throw new SpaceError('Espaço não encontrado', 404)
  return ws
}

/** Define o espaço ativo do usuário (grava em User.workspaceId). A rota atualiza o token depois. */
export async function switchSpace(userId: string, organizationId: string, workspaceId: string): Promise<void> {
  const ws = await ownedSpace(organizationId, workspaceId)
  if (ws.arquivadoEm) throw new SpaceError('Este WhatsApp está arquivado', 409)
  // Equipe: atendente só troca para espaço em que é membro (id direto não adianta).
  if (!(await userCanAccessSpace(userId, workspaceId))) throw new SpaceError('Você não tem acesso a este WhatsApp', 403, 'SEM_ACESSO')
  await db.user.update({ where: { id: userId }, data: { workspaceId, organizationId } })
  invalidateActiveSpace(userId)
}

export async function updateSpace(organizationId: string, workspaceId: string, input: { nome?: string; ordem?: number }): Promise<void> {
  await ownedSpace(organizationId, workspaceId)
  await db.workspace.update({
    where: { id: workspaceId },
    data: { ...(input.nome !== undefined ? { nome: input.nome } : {}), ...(input.ordem !== undefined ? { ordem: input.ordem } : {}) },
  })
}

/**
 * Arquiva o espaço: só com o WhatsApp DESCONECTADO e havendo outro espaço. Não apaga nada.
 * Quem estava com ele ativo passa para outro espaço da organização. Devolve o novo ativo desses usuários.
 */
export async function archiveSpace(organizationId: string, workspaceId: string): Promise<{ proximoId: string }> {
  const ws = await ownedSpace(organizationId, workspaceId)
  if (ws.arquivadoEm) throw new SpaceError('Este WhatsApp já está arquivado', 409)
  const sess = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { status: true, provider: true } })
  if (sess && (sess.status === 'CONECTADO' || sess.status === 'CONECTANDO')) {
    throw new SpaceError('Desconecte o WhatsApp antes de arquivar', 409, 'CONECTADO')
  }
  const outro = await db.workspace.findFirst({
    where: { organizationId, arquivadoEm: null, NOT: { id: workspaceId } },
    orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  if (!outro) throw new SpaceError('Você precisa manter pelo menos um WhatsApp', 409, 'ULTIMO_ESPACO')

  // Aguardando QR / erro: derruba a instância do provedor para ela não conectar sozinha depois de arquivada.
  if (sess?.provider) {
    await getProvider(providerToKind(sess.provider))
      .disconnect(workspaceId)
      .catch((e) => console.error('[spaces/archive] falha no provedor:', e instanceof Error ? e.message : 'erro'))
  }
  await setStatus(workspaceId, 'desconectado', {
    provider: null,
    numero: null,
    qr: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    evolutionInstance: null,
    sessionData: null,
    resetHistory: true,
  })
  await disableAutomations(workspaceId)

  // Trava por organização: dois arquivamentos simultâneos não podem deixar a conta sem nenhum espaço ativo.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'space:' + organizationId}))`
    const restantes = await tx.workspace.count({ where: { organizationId, arquivadoEm: null, NOT: { id: workspaceId } } })
    if (restantes === 0) throw new SpaceError('Você precisa manter pelo menos um WhatsApp', 409, 'ULTIMO_ESPACO')
    await tx.workspace.update({ where: { id: workspaceId }, data: { arquivadoEm: new Date() } })
    await tx.user.updateMany({ where: { organizationId, workspaceId }, data: { workspaceId: outro.id } })
  })
  invalidateActiveSpace()
  return { proximoId: outro.id }
}
