import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import type { Plan } from '@prisma/client'
import { db } from '@/lib/db'
import { audit, maskEmail } from '@/server/audit/log'
import { canManageTarget, normalizePapel, PAPEL_LABEL } from '@/server/auth/permissions'
import type { Papel } from '@/server/auth/permissions'
import { mailConfigured, sendMail } from '@/server/mail/send'
import { appBaseUrl, teamInviteEmail } from '@/server/mail/templates'
import { disconnectUser, removeUserFromRooms } from '@/server/realtime/emit'
import { attentionRoom, orgRoom, workspaceRoom } from '@/server/realtime/events'
import { BLOCKED_MESSAGE, consume } from '@/server/security/rate-limit'
import { hmac } from '@/server/security/hash'
import { invalidateActiveSpace } from '@/server/spaces/org'
import { PLAN_MEMBER_LIMIT } from './limits'
import type { InviteDTO, MemberDTO, TeamResponse } from './types'

export const INVITE_TTL_MS = 7 * 24 * 3_600_000

export class TeamError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}

export type Actor = { userId: string; organizationId: string; papel: Papel }

// ---------------------------------------------------------------------------------------------------------------
// Token do convite: 32 bytes aleatórios; no banco fica SÓ o hash (HMAC com o AUTH_SECRET).
// ---------------------------------------------------------------------------------------------------------------

const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => hmac('team-invite', token)
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const inviteLink = (token: string) => `${appBaseUrl()}/convite/${token}`

type InviteRow = Awaited<ReturnType<typeof db.invite.findFirstOrThrow>>
export type InviteStatus = 'valido' | 'expirado' | 'revogado' | 'usado'
export function inviteStatus(inv: Pick<InviteRow, 'aceitoEm' | 'revogadoEm' | 'expiraEm'>, now = new Date()): InviteStatus {
  if (inv.aceitoEm) return 'usado'
  if (inv.revogadoEm) return 'revogado'
  if (inv.expiraEm <= now) return 'expirado'
  return 'valido'
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

async function lockTeam(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'team:' + organizationId}))`
}

// ---------------------------------------------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------------------------------------------

const toInviteDTO = (i: InviteRow, now = new Date()): InviteDTO => ({
  id: i.id,
  email: i.email,
  papel: normalizePapel(i.papel) as 'admin' | 'agent',
  workspaceIds: i.workspaceIds,
  createdAt: i.createdAt.toISOString(),
  expiraEm: i.expiraEm.toISOString(),
  expirado: i.expiraEm <= now,
})

export async function listTeam(actor: Actor): Promise<TeamResponse> {
  const { organizationId } = actor
  const now = new Date()
  const [org, users, invites, spaces] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { plano: true, nome: true } }),
    db.user.findMany({
      where: { organizationId, desativadoEm: null },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, nome: true, email: true, papel: true, fotoUrl: true, image: true, createdAt: true, spaceMemberships: { select: { workspaceId: true } } },
    }),
    db.invite.findMany({ where: { organizationId, aceitoEm: null, revogadoEm: null }, orderBy: { createdAt: 'desc' } }),
    db.workspace.findMany({ where: { organizationId, arquivadoEm: null }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }], select: { id: true, nome: true } }),
  ])
  const membros: MemberDTO[] = users.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: normalizePapel(u.papel),
    fotoUrl: u.fotoUrl ?? u.image,
    // dono/admin enxergam todos os espaços; atendente, só os liberados
    workspaceIds: normalizePapel(u.papel) === 'agent' ? u.spaceMemberships.map((m) => m.workspaceId) : null,
    voce: u.id === actor.userId,
  }))
  const pendentes = invites.filter((i) => i.expiraEm > now).length
  return {
    membros,
    convites: invites.map((i) => toInviteDTO(i, now)),
    espacos: spaces,
    plano: org.plano,
    limite: PLAN_MEMBER_LIMIT[org.plano],
    usados: membros.length + pendentes,
    emailConfigurado: mailConfigured(),
    meuPapel: actor.papel,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------------------------------------------

/** Espaços (ids) da organização, não arquivados, dentre os pedidos. Qualquer id de outra organização é recusado. */
async function validSpaceIds(organizationId: string, ids: string[]): Promise<string[]> {
  const uniq = Array.from(new Set(ids))
  if (uniq.length === 0) return []
  const rows = await db.workspace.findMany({ where: { id: { in: uniq }, organizationId, arquivadoEm: null }, select: { id: true } })
  if (rows.length !== uniq.length) throw new TeamError('WhatsApp inválido', 400, 'ESPACO_INVALIDO')
  return rows.map((r) => r.id)
}

async function deliverInvite(actorUserId: string, organizationId: string, email: string, papel: Papel, token: string): Promise<boolean> {
  if (!mailConfigured()) return false
  const [org, who] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { nome: true } }),
    db.user.findUnique({ where: { id: actorUserId }, select: { nome: true } }),
  ])
  const r = await sendMail({
    to: email,
    ...teamInviteEmail({ link: inviteLink(token), organizacao: org?.nome ?? 'sua empresa', convidadoPor: who?.nome, papel: PAPEL_LABEL[papel].toLowerCase() }),
  })
  return r.ok
}

export type InviteResult = { convite: InviteDTO; link: string; emailEnviado: boolean; emailConfigurado: boolean }

export async function createInvite(actor: Actor, input: { email: string; papel: 'admin' | 'agent'; workspaceIds: string[] }): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase()
  const workspaceIds = input.papel === 'agent' ? await validSpaceIds(actor.organizationId, input.workspaceIds) : []
  if (input.papel === 'agent' && workspaceIds.length === 0) throw new TeamError('Escolha pelo menos um WhatsApp para o atendente', 400, 'SEM_ESPACO')

  const token = newToken()
  const inv = await db.$transaction(async (tx) => {
    await lockTeam(tx, actor.organizationId)
    const existing = await tx.user.findUnique({ where: { email }, select: { organizationId: true, desativadoEm: true } })
    if (existing && !existing.desativadoEm && existing.organizationId === actor.organizationId) {
      throw new TeamError('Esta pessoa já faz parte da equipe', 409, 'JA_E_MEMBRO')
    }
    // Um convite pendente por e-mail: o novo substitui o anterior.
    await tx.invite.updateMany({ where: { organizationId: actor.organizationId, email, aceitoEm: null, revogadoEm: null }, data: { revogadoEm: new Date() } })
    const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { plano: true } })
    await assertSeat(tx, actor.organizationId, org.plano)
    return tx.invite.create({
      data: {
        organizationId: actor.organizationId,
        email,
        papel: input.papel,
        workspaceIds,
        tokenHash: hashToken(token),
        convidadoPorId: actor.userId,
        expiraEm: new Date(Date.now() + INVITE_TTL_MS),
      },
    })
  })
  await audit({ organizationId: actor.organizationId, userId: actor.userId, acao: 'invite.created', alvo: maskEmail(email), meta: { papel: input.papel } })
  const emailEnviado = await deliverInvite(actor.userId, actor.organizationId, email, input.papel, token)
  return { convite: toInviteDTO(inv), link: inviteLink(token), emailEnviado, emailConfigurado: mailConfigured() }
}

/** Limite de pessoas do plano: usuários ativos + convites pendentes (não expirados). 403 LIMITE_PLANO. */
async function assertSeat(tx: Prisma.TransactionClient, organizationId: string, plano: Plan) {
  const limite = PLAN_MEMBER_LIMIT[plano]
  const [users, pend] = await Promise.all([
    tx.user.count({ where: { organizationId, desativadoEm: null } }),
    tx.invite.count({ where: { organizationId, aceitoEm: null, revogadoEm: null, expiraEm: { gt: new Date() } } }),
  ])
  if (users + pend + 1 > limite) {
    throw new TeamError(`Seu plano permite ${limite} ${limite === 1 ? 'pessoa' : 'pessoas'} na equipe`, 403, 'LIMITE_PLANO')
  }
}

async function ownInvite(actor: Actor, id: string): Promise<InviteRow> {
  const inv = await db.invite.findFirst({ where: { id, organizationId: actor.organizationId } })
  if (!inv) throw new TeamError('Convite não encontrado', 404)
  return inv
}

export async function revokeInvite(actor: Actor, id: string): Promise<void> {
  const inv = await ownInvite(actor, id)
  if (inv.aceitoEm) throw new TeamError('Este convite já foi aceito', 409, 'USADO')
  if (!inv.revogadoEm) await db.invite.update({ where: { id }, data: { revogadoEm: new Date() } })
  await audit({ organizationId: actor.organizationId, userId: actor.userId, acao: 'invite.revoked', alvo: maskEmail(inv.email) })
}

/** Gera um token NOVO (o antigo deixa de valer), renova a validade e, se pedido e possível, reenvia o e-mail. */
export async function resendInvite(actor: Actor, id: string, opts: { enviarEmail: boolean }): Promise<InviteResult> {
  const inv = await ownInvite(actor, id)
  if (inv.aceitoEm) throw new TeamError('Este convite já foi aceito', 409, 'USADO')
  const token = newToken()
  const updated = await db.$transaction(async (tx) => {
    await lockTeam(tx, actor.organizationId)
    const fresh = await tx.invite.findUniqueOrThrow({ where: { id } })
    // Convite revogado ou expirado volta a ocupar uma vaga: confere o limite do plano de novo.
    if (fresh.revogadoEm || fresh.expiraEm <= new Date()) {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { plano: true } })
      await assertSeat(tx, actor.organizationId, org.plano)
    }
    return tx.invite.update({ where: { id }, data: { tokenHash: hashToken(token), expiraEm: new Date(Date.now() + INVITE_TTL_MS), revogadoEm: null } })
  })
  await audit({ organizationId: actor.organizationId, userId: actor.userId, acao: 'invite.resent', alvo: maskEmail(inv.email) })
  const emailEnviado = opts.enviarEmail ? await deliverInvite(actor.userId, actor.organizationId, inv.email, normalizePapel(inv.papel), token) : false
  return { convite: toInviteDTO(updated), link: inviteLink(token), emailEnviado, emailConfigurado: mailConfigured() }
}

// ---------------------------------------------------------------------------------------------------------------
// Aceitar convite (página pública)
// ---------------------------------------------------------------------------------------------------------------

export type InvitePreview =
  | { status: 'valido'; organizacao: string; papel: Papel }
  | { status: 'expirado' | 'revogado' | 'usado' | 'invalido' | 'bloqueado' }

async function findByToken(token: string): Promise<InviteRow | null> {
  if (!TOKEN_RE.test(token)) return null
  return db.invite.findUnique({ where: { tokenHash: hashToken(token) } })
}

/**
 * Dados MÍNIMOS para a página pública: nome da organização e papel. Nada de membros nem espaços, e nada que revele
 * se o e-mail já tem conta. Cada consulta conta no limite de tentativas por IP.
 */
export async function previewInvite(token: string, ip: string): Promise<InvitePreview> {
  const rl = await consume('inviteToken', { ip })
  if (rl.blocked) return { status: 'bloqueado' }
  const inv = await findByToken(token)
  if (!inv) return { status: 'invalido' }
  const st = inviteStatus(inv)
  if (st !== 'valido') return { status: st }
  const org = await db.organization.findUnique({ where: { id: inv.organizationId }, select: { nome: true } })
  return { status: 'valido', organizacao: org?.nome ?? 'PearChat', papel: normalizePapel(inv.papel) }
}

/** Marca o convite como usado de forma atômica (uso único): só uma chamada concorrente vence. */
async function claimInvite(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const r = await tx.invite.updateMany({ where: { id, aceitoEm: null, revogadoEm: null, expiraEm: { gt: new Date() } }, data: { aceitoEm: new Date() } })
  return r.count === 1
}

/** Espaços liberados e espaço ativo inicial do novo membro. */
async function accessFor(tx: Prisma.TransactionClient, inv: InviteRow): Promise<{ papel: Papel; memberIds: string[]; activeId: string }> {
  const papel = normalizePapel(inv.papel) === 'admin' ? 'admin' : 'agent'
  if (papel === 'agent') {
    const rows = await tx.workspace.findMany({
      where: { id: { in: inv.workspaceIds }, organizationId: inv.organizationId, arquivadoEm: null },
      orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
    if (rows.length === 0) throw new TeamError('Os WhatsApps deste convite não estão mais disponíveis. Peça um novo convite.', 409, 'ESPACO_INDISPONIVEL')
    return { papel, memberIds: rows.map((r) => r.id), activeId: rows[0].id }
  }
  const first = await tx.workspace.findFirst({ where: { organizationId: inv.organizationId, arquivadoEm: null }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }], select: { id: true } })
  if (!first) throw new TeamError('Esta conta não tem WhatsApp disponível', 409, 'ESPACO_INDISPONIVEL')
  return { papel, memberIds: [], activeId: first.id }
}

const ACCOUNT_EXISTS = () => new TeamError('Este e-mail já tem uma conta PearChat. Use outro e-mail.', 409, 'CONTA_EXISTENTE')

/** Cria (ou reativa) o membro dentro da organização que convidou. Chamado já dentro da transação, com o convite reivindicado. */
async function joinFromInvite(
  tx: Prisma.TransactionClient,
  inv: InviteRow,
  data: { nome: string; passwordHash: string | null; image?: string | null },
): Promise<{ id: string; reactivated: boolean }> {
  const access = await accessFor(tx, inv)
  const existing = await tx.user.findUnique({ where: { email: inv.email }, select: { id: true, organizationId: true, desativadoEm: true } })
  if (existing && !(existing.desativadoEm && existing.organizationId === inv.organizationId)) throw ACCOUNT_EXISTS()

  let userId: string
  if (existing) {
    // Reativação (convite novo para quem foi removido): senha nova, sessões antigas continuam invalidadas.
    await tx.user.update({
      where: { id: existing.id },
      data: {
        desativadoEm: null,
        papel: access.papel,
        nome: data.nome,
        ...(data.passwordHash ? { passwordHash: data.passwordHash } : {}),
        workspaceId: access.activeId,
        emailVerified: new Date(),
        sessionVersion: { increment: 1 },
      },
    })
    await tx.spaceMember.deleteMany({ where: { userId: existing.id } })
    userId = existing.id
  } else {
    const u = await tx.user.create({
      data: {
        workspaceId: access.activeId,
        organizationId: inv.organizationId,
        nome: data.nome,
        email: inv.email,
        passwordHash: data.passwordHash,
        papel: access.papel,
        emailVerified: new Date(), // o convite chegou ao e-mail: prova de posse
        image: data.image ?? null,
      },
      select: { id: true },
    })
    userId = u.id
  }
  if (access.memberIds.length) await tx.spaceMember.createMany({ data: access.memberIds.map((workspaceId) => ({ userId, workspaceId })), skipDuplicates: true })
  return { id: userId, reactivated: !!existing }
}

export type AcceptResult = { ok: true; email: string } | { ok: false; code: string; message: string }

const FRIENDLY: Record<string, string> = {
  expirado: 'Este convite expirou. Peça um novo convite a quem convidou você.',
  revogado: 'Este convite foi cancelado. Peça um novo convite a quem convidou você.',
  usado: 'Este convite já foi usado. Se a conta é sua, é só entrar.',
  invalido: 'Convite não encontrado. Confira o link ou peça um novo convite.',
}

/** Aceita o convite com e-mail+senha: cria o usuário JÁ na organização que convidou (sem organização/espaço novos). */
export async function acceptInvite(token: string, input: { nome: string; senha: string }, ip: string): Promise<AcceptResult> {
  const rl = await consume('inviteToken', { ip })
  if (rl.blocked) return { ok: false, code: 'bloqueado', message: BLOCKED_MESSAGE }
  const inv = await findByToken(token)
  if (!inv) return { ok: false, code: 'invalido', message: FRIENDLY.invalido }
  const st = inviteStatus(inv)
  if (st !== 'valido') return { ok: false, code: st, message: FRIENDLY[st] }

  const passwordHash = await bcrypt.hash(input.senha, 10)
  try {
    const joined = await db.$transaction(async (tx) => {
      await lockTeam(tx, inv.organizationId)
      if (!(await claimInvite(tx, inv.id))) throw new TeamError(FRIENDLY.usado, 409, 'usado')
      return joinFromInvite(tx, inv, { nome: input.nome, passwordHash })
    })
    invalidateActiveSpace(joined.id)
    await audit({ organizationId: inv.organizationId, userId: joined.id, acao: 'invite.accepted', alvo: maskEmail(inv.email), meta: { papel: normalizePapel(inv.papel) } })
    return { ok: true, email: inv.email }
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, code: e.code ?? 'erro', message: e.message }
    if (isUnique(e)) return { ok: false, code: 'CONTA_EXISTENTE', message: ACCOUNT_EXISTS().message }
    throw e
  }
}

/**
 * Login com Google de um e-mail que tem convite pendente: entra na organização que convidou em vez de criar uma
 * organização nova. null = sem convite válido (o adapter segue o caminho normal).
 */
export async function createUserFromPendingInvite(email: string, data: { nome: string; image?: string | null }) {
  const mail = email.trim().toLowerCase()
  const inv = await db.invite.findFirst({ where: { email: mail, aceitoEm: null, revogadoEm: null, expiraEm: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
  if (!inv) return null
  try {
    const joined = await db.$transaction(async (tx) => {
      await lockTeam(tx, inv.organizationId)
      if (!(await claimInvite(tx, inv.id))) throw new TeamError(FRIENDLY.usado, 409, 'usado')
      return joinFromInvite(tx, inv, { nome: data.nome, passwordHash: null, image: data.image })
    })
    invalidateActiveSpace(joined.id)
    await audit({ organizationId: inv.organizationId, userId: joined.id, acao: 'invite.accepted', alvo: maskEmail(mail), meta: { papel: normalizePapel(inv.papel), via: 'google' } })
    return db.user.findUnique({ where: { id: joined.id } })
  } catch (e) {
    if (e instanceof TeamError || isUnique(e)) return null
    throw e
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------------------------------------------

/** Alvo precisa ser da MESMA organização do ator (ids vindos do cliente nunca valem sozinhos). */
async function ownMember(actor: Actor, id: string) {
  const m = await db.user.findFirst({
    where: { id, organizationId: actor.organizationId, desativadoEm: null },
    select: { id: true, nome: true, email: true, papel: true, workspaceId: true, spaceMemberships: { select: { workspaceId: true } } },
  })
  if (!m) throw new TeamError('Pessoa não encontrada', 404)
  return m
}

async function otherOwners(tx: Prisma.TransactionClient | typeof db, organizationId: string, exceptId: string): Promise<number> {
  return tx.user.count({ where: { organizationId, papel: 'owner', desativadoEm: null, NOT: { id: exceptId } } })
}

export async function updateMember(actor: Actor, id: string, input: { papel?: Papel; workspaceIds?: string[] }): Promise<void> {
  const target = await ownMember(actor, id)
  const targetPapel = normalizePapel(target.papel)
  if (!canManageTarget(actor.papel, targetPapel)) throw new TeamError('Você não pode alterar o dono da conta', 403, 'SEM_PERMISSAO')
  const nextPapel: Papel = input.papel ?? targetPapel
  if (input.papel === 'owner' && actor.papel !== 'owner') throw new TeamError('Só o dono pode nomear outro dono', 403, 'SEM_PERMISSAO')
  // Ninguém sobe o próprio papel (admin não vira dono sozinho, atendente não vira admin).
  const rank: Record<Papel, number> = { agent: 0, admin: 1, owner: 2 }
  if (id === actor.userId && rank[nextPapel] > rank[targetPapel]) throw new TeamError('Você não pode aumentar o seu próprio papel', 403, 'SEM_PERMISSAO')

  const requested = input.workspaceIds ?? (nextPapel === 'agent' ? target.spaceMemberships.map((m) => m.workspaceId) : [])
  const spaceIds = nextPapel === 'agent' ? await validSpaceIds(actor.organizationId, requested) : []
  if (nextPapel === 'agent' && spaceIds.length === 0) throw new TeamError('Escolha pelo menos um WhatsApp para o atendente', 400, 'SEM_ESPACO')

  const before = new Set(target.spaceMemberships.map((m) => m.workspaceId))
  await db.$transaction(async (tx) => {
    await lockTeam(tx, actor.organizationId)
    // Último dono: nunca fica a conta sem dono.
    if (targetPapel === 'owner' && nextPapel !== 'owner' && (await otherOwners(tx, actor.organizationId, id)) === 0) {
      throw new TeamError('A conta precisa de pelo menos um dono', 409, 'ULTIMO_DONO')
    }
    await tx.user.update({ where: { id }, data: { papel: nextPapel } })
    await tx.spaceMember.deleteMany({ where: { userId: id, ...(spaceIds.length ? { workspaceId: { notIn: spaceIds } } : {}) } })
    if (spaceIds.length) await tx.spaceMember.createMany({ data: spaceIds.map((workspaceId) => ({ userId: id, workspaceId })), skipDuplicates: true })
    // Espaço retirado do atendente: as conversas que estavam com ele ficam sem responsável.
    const removed = nextPapel === 'agent' ? Array.from(before).filter((w) => !spaceIds.includes(w)) : []
    if (removed.length) await tx.conversation.updateMany({ where: { assigneeId: id, workspaceId: { in: removed } }, data: { assigneeId: null, assignedAt: null } })
  })
  invalidateActiveSpace(id)

  // Sockets abertos: sai das salas a que não tem mais direito.
  const rooms: string[] = []
  const now = new Set(spaceIds)
  if (nextPapel === 'agent') {
    rooms.push(orgRoom(actor.organizationId))
    const all = await db.workspace.findMany({ where: { organizationId: actor.organizationId }, select: { id: true } })
    for (const w of all) if (!now.has(w.id)) rooms.push(workspaceRoom(w.id), attentionRoom(w.id))
  }
  removeUserFromRooms(id, rooms)

  if (nextPapel !== targetPapel) {
    await audit({ organizationId: actor.organizationId, userId: actor.userId, acao: 'member.role_changed', alvo: maskEmail(target.email), meta: { de: targetPapel, para: nextPapel } })
  }
  const changedSpaces = nextPapel === 'agent' && (spaceIds.length !== before.size || spaceIds.some((w) => !before.has(w)))
  if (changedSpaces) await audit({ organizationId: actor.organizationId, userId: actor.userId, acao: 'member.spaces_changed', alvo: maskEmail(target.email), meta: { total: spaceIds.length } })
}

/**
 * Remove da equipe SEM apagar o usuário: marca `desativadoEm`, sobe a versão de sessão (derruba os JWTs), tira as
 * conversas dele do "responsável" e derruba os sockets. O mesmo e-mail pode voltar por um novo convite.
 */
export async function removeMember(actor: Actor, id: string): Promise<void> {
  if (id === actor.userId) throw new TeamError('Você não pode remover a si mesmo', 409, 'PROPRIO_USUARIO')
  const target = await ownMember(actor, id)
  const targetPapel = normalizePapel(target.papel)
  if (!canManageTarget(actor.papel, targetPapel)) throw new TeamError('Você não pode remover o dono da conta', 403, 'SEM_PERMISSAO')
  await db.$transaction(async (tx) => {
    await lockTeam(tx, actor.organizationId)
    if (targetPapel === 'owner' && (await otherOwners(tx, actor.organizationId, id)) === 0) {
      throw new TeamError('A conta precisa de pelo menos um dono', 409, 'ULTIMO_DONO')
    }
    await tx.user.update({ where: { id }, data: { desativadoEm: new Date(), sessionVersion: { increment: 1 } } })
    await tx.spaceMember.deleteMany({ where: { userId: id } })
    await tx.conversation.updateMany({ where: { assigneeId: id }, data: { assigneeId: null, assignedAt: null } })
  })
  invalidateActiveSpace(id)
  disconnectUser(id)
  await audit({ organizationId: actor.organizationId, userId: actor.userId, acao: 'member.removed', alvo: maskEmail(target.email) })
}

// ---------------------------------------------------------------------------------------------------------------
// Atividade recente (só o dono)
// ---------------------------------------------------------------------------------------------------------------

export type ActivityDTO = { id: string; acao: string; alvo: string | null; quem: string | null; quando: string }

export async function recentActivity(organizationId: string, take = 20): Promise<ActivityDTO[]> {
  const rows = await db.auditLog.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take })
  const ids = Array.from(new Set(rows.map((r) => r.userId).filter((v): v is string => !!v)))
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }) : []
  const names = new Map(users.map((u) => [u.id, u.nome]))
  return rows.map((r) => ({ id: r.id, acao: r.acao, alvo: r.alvo, quem: r.userId ? (names.get(r.userId) ?? null) : null, quando: r.createdAt.toISOString() }))
}
