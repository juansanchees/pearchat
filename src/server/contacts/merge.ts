import { Prisma } from '@prisma/client'
import type { Contact, Conversation } from '@prisma/client'
import { db } from '@/lib/db'
import { phoneCandidates } from '@/lib/phone'
import { logError } from '@/server/engine/util'
import { contactPhotoIdFromUrl, deleteContactPhoto } from '@/server/media/avatars'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'

// Unificação de contatos do MESMO cliente que apareceu por dois identificadores (LID/BSUID em `waUserId` e telefone).
//
// Regra (decidida pelo orquestrador, não ampliar): só com PROVA. Prova = o mesmo evento do provedor traz o LID e o
// telefone, e eles apontam para dois contatos diferentes do mesmo espaço; nunca por nome, foto ou semelhança.
// Grupos nunca chegam aqui (jidToRef devolve null para @g.us). O script de duplicados antigos usa a mesma prova
// (o evento bruto ainda guardado na caixa de entrada dos webhooks).
//
// Tudo numa transação: trava consultiva por (espaço, telefone) + FOR UPDATE nas linhas dos contatos e das conversas
// (um webhook concorrente do mesmo cliente espera e, ao continuar, já enxerga o resultado). Mantém o contato mais
// antigo (empate: o que tem telefone), move mensagens/jobs/agenda/disparos para ele, apaga o duplicado vazio, grava
// AuditLog (só ids e contagens) e, depois do commit, avisa a tela (conversation.updated + conversation.merged).

type Tx = Prisma.TransactionClient
type Client = Tx | typeof db

export type ProofRef = { waUserId?: string | null; telefone?: string | null }

export type MergeResult = {
  keepId: string
  dupId: string
  keepConversationId: string | null
  removedConversationId: string | null
  mensagensMovidas: number
  mensagensDescartadas: number
  aiJobsMovidos: number
  aiJobsCancelados: number
  followUpsMovidos: number
  followUpsCancelados: number
  eventosMovidos: number
  disparosMovidos: number
  disparosDescartados: number
  notificacoesAjustadas: number
}

/** Mais antigo fica; empate de createdAt: o que tem telefone; empate total: o menor id (determinístico). */
export function chooseKeep(a: Contact, b: Contact): { keep: Contact; dup: Contact } {
  const ta = a.createdAt.getTime()
  const tb = b.createdAt.getTime()
  if (ta !== tb) return ta < tb ? { keep: a, dup: b } : { keep: b, dup: a }
  if (!!a.telefone !== !!b.telefone) return a.telefone ? { keep: a, dup: b } : { keep: b, dup: a }
  return a.id < b.id ? { keep: a, dup: b } : { keep: b, dup: a }
}

/**
 * Os dois contatos não podem virar um só sem perder um identificador (dois LIDs diferentes, ou dois telefones que não
 * são o mesmo número em outro formato): não é o mesmo cliente com certeza, então não une.
 */
export function identifiersConflict(a: Contact, b: Contact): boolean {
  if (a.waUserId && b.waUserId && a.waUserId !== b.waUserId) return true
  if (a.telefone && b.telefone && !phoneCandidates(a.telefone).includes(b.telefone)) return true
  return false
}

async function proofPair(client: Client, workspaceId: string, ref: ProofRef): Promise<{ byLid: Contact; byPhone: Contact } | null> {
  const { waUserId, telefone } = ref
  if (!waUserId || !telefone) return null
  const byLid = await client.contact.findUnique({ where: { workspaceId_waUserId: { workspaceId, waUserId } } })
  if (!byLid) return null
  const cands = phoneCandidates(telefone)
  const found = await client.contact.findMany({ where: { workspaceId, telefone: { in: cands } } })
  const byPhone = found.find((c) => c.telefone === telefone) ?? found[0]
  if (!byPhone || byPhone.id === byLid.id) return null
  // O telefone já está ligado a OUTRO LID, ou o LID já tem outro número: o evento não prova que são o mesmo contato.
  if (byPhone.waUserId && byPhone.waUserId !== waUserId) return null
  if (byLid.telefone && !cands.includes(byLid.telefone)) return null
  return { byLid, byPhone }
}

/**
 * Par a unificar segundo a PROVA de um evento (LID + telefone no mesmo evento, em dois contatos diferentes do espaço).
 * null = nada a unificar (sem prova, já unificado, ou identificadores em conflito).
 */
export async function findMergeByProof(workspaceId: string, ref: ProofRef): Promise<{ keepId: string; dupId: string } | null> {
  const pair = await proofPair(db, workspaceId, ref)
  if (!pair) return null
  const { keep, dup } = chooseKeep(pair.byLid, pair.byPhone)
  return { keepId: keep.id, dupId: dup.id }
}

const isBlankName = (c: Contact) => {
  const n = c.nome.trim()
  if (!n || n === 'Contato') return true
  const digits = n.replace(/\D/g, '')
  if (c.telefone && (n === c.telefone || digits === c.telefone.replace(/\D/g, ''))) return true
  if (c.waUserId && (n === c.waUserId || digits === c.waUserId)) return true
  return false
}

/** Campos do contato mantido depois da fusão (identificadores do duplicado entram onde o mantido não tem). */
function mergedContactData(keep: Contact, dup: Contact): Prisma.ContactUpdateInput {
  const keepPhoto = !!keep.photoUrl
  const tags = Array.from(new Set([...keep.tags, ...dup.tags]))
  const data: Prisma.ContactUpdateInput = {
    waUserId: keep.waUserId ?? dup.waUserId,
    telefone: keep.telefone ?? dup.telefone,
    // Nome de verdade (o que não é só o número/LID); sem nenhum, o telefone (como nasce um contato novo).
    nome: !isBlankName(keep) ? keep.nome : !isBlankName(dup) ? dup.nome : (keep.telefone ?? dup.telefone ?? keep.nome),
    email: keep.email ?? dup.email,
    tags,
    endereco: keep.endereco ?? dup.endereco,
    aniversario: keep.aniversario ?? dup.aniversario,
    notas: keep.notas && dup.notas && keep.notas !== dup.notas ? `${keep.notas}\n\n${dup.notas}` : (keep.notas ?? dup.notas),
    // Pediu para parar em qualquer um dos dois: vale para o cliente.
    optOut: keep.optOut || dup.optOut,
    photoUrl: keepPhoto ? keep.photoUrl : dup.photoUrl,
    photoCheckedAt: keepPhoto ? keep.photoCheckedAt : (dup.photoCheckedAt ?? keep.photoCheckedAt),
    pedidos: keep.pedidos || dup.pedidos,
    totalGasto: !new Prisma.Decimal(keep.totalGasto).isZero() ? keep.totalGasto : dup.totalGasto,
    clienteDesde:
      keep.clienteDesde && dup.clienteDesde
        ? (keep.clienteDesde < dup.clienteDesde ? keep.clienteDesde : dup.clienteDesde)
        : (keep.clienteDesde ?? dup.clienteDesde),
  }
  return data
}

const PENDING_FU = 'pendente'
const PENDING_AI = 'pendente'

/** Move tudo da conversa `from` para `into` (mesmo cliente) e apaga `from`, já vazia. */
async function mergeConversations(tx: Tx, into: Conversation, from: Conversation, r: MergeResult): Promise<void> {
  // Mensagens repetidas (mesmo id do provedor ou mesma chave de envio nas duas conversas): fica a mais antiga.
  const clashes = await tx.$queryRaw<{ d: string; k: string; dAt: Date; kAt: Date }[]>`
    SELECT d."id" AS d, k."id" AS k, d."createdAt" AS "dAt", k."createdAt" AS "kAt"
    FROM "Message" d
    JOIN "Message" k ON k."conversationId" = ${into.id}
      AND ((d."providerMessageId" IS NOT NULL AND k."providerMessageId" = d."providerMessageId")
        OR (d."sendKey" IS NOT NULL AND k."sendKey" = d."sendKey"))
    WHERE d."conversationId" = ${from.id}`
  const drop = new Set<string>()
  for (const c of clashes) drop.add(c.dAt.getTime() < c.kAt.getTime() ? c.k : c.d)
  if (drop.size) {
    await tx.message.deleteMany({ where: { id: { in: Array.from(drop) } } })
    r.mensagensDescartadas = drop.size
  }
  r.mensagensMovidas = (await tx.message.updateMany({ where: { conversationId: from.id }, data: { conversationId: into.id } })).count

  // Jobs: um só pendente por conversa (o do mantido vale; o do duplicado é cancelado).
  const keepAiPending = await tx.aiJob.count({ where: { conversationId: into.id, status: PENDING_AI } })
  if (keepAiPending) {
    // AiJob não tem estado "cancelado" (erro/feito viram avisos no sininho): o pendente do duplicado, que ainda não rodou, sai.
    r.aiJobsCancelados = (await tx.aiJob.deleteMany({ where: { conversationId: from.id, status: PENDING_AI } })).count
  }
  r.aiJobsMovidos = (await tx.aiJob.updateMany({ where: { conversationId: from.id }, data: { conversationId: into.id } })).count

  const keepFuPending = await tx.followUpJob.count({ where: { conversationId: into.id, status: PENDING_FU } })
  if (keepFuPending) {
    r.followUpsCancelados = (
      await tx.followUpJob.updateMany({ where: { conversationId: from.id, status: PENDING_FU }, data: { status: 'cancelado', error: 'Contato unificado' } })
    ).count
  }
  r.followUpsMovidos = (await tx.followUpJob.updateMany({ where: { conversationId: from.id }, data: { conversationId: into.id } })).count

  // Campos derivados: não lidas somam; última mensagem = a mais nova; HUMANO em qualquer uma vence (uma pessoa está
  // atendendo: a IA não pode voltar a responder por causa da fusão); responsável do mantido vence, senão o do outro.
  const last = await tx.message.findFirst({ where: { conversationId: into.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true } })
  const lastAt = [into.lastMessageAt, from.lastMessageAt, last?.createdAt ?? null]
    .filter((d): d is Date => !!d)
    .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null)
  const mode = into.mode === 'HUMANO' || from.mode === 'HUMANO' ? 'HUMANO' : (into.mode ?? from.mode)
  const useFromAssignee = !into.assigneeId && !!from.assigneeId
  await tx.conversation.update({
    where: { id: into.id },
    data: {
      unread: into.unread + from.unread,
      lastMessageAt: lastAt,
      mode,
      typing: false,
      ...(useFromAssignee ? { assigneeId: from.assigneeId, assignedAt: from.assignedAt } : {}),
      ...(into.ofertasIa == null && from.ofertasIa != null ? { ofertasIa: from.ofertasIa as Prisma.InputJsonValue } : {}),
    },
  })

  // Sininho: links e ids somados que apontavam para a conversa que sai passam a apontar para a mantida.
  const fromLink = `/whatsapp?c=${from.id}`
  const toLink = `/whatsapp?c=${into.id}`
  const links = await tx.notification.updateMany({ where: { workspaceId: into.workspaceId, link: fromLink }, data: { link: toLink } })
  const refs = await tx.$executeRaw`
    UPDATE "Notification" SET "refIds" = jsonb_set("refIds", '{ids}', (
      SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN x = ${from.id} THEN ${into.id} ELSE x END), '[]'::jsonb)
      FROM jsonb_array_elements_text("refIds"->'ids') AS x))
    WHERE "workspaceId" = ${into.workspaceId}
      AND jsonb_typeof("refIds"->'ids') = 'array'
      AND ("refIds"->'ids') ? ${from.id}`
  r.notificacoesAjustadas = links.count + refs

  await tx.conversation.delete({ where: { id: from.id } })
}

export type MergeOptions = {
  /** Prova do evento: dentro da trava a prova é REAVALIADA (outro webhook pode ter unificado antes). */
  proof?: ProofRef
  /** Quem pediu (script): vai para o AuditLog.meta.origem. */
  origem?: 'webhook' | 'script'
}

/**
 * Unifica dois contatos do mesmo espaço (o mais antigo fica; ver chooseKeep). Idempotente: se um dos dois já não
 * existe (outro processo unificou) ou a prova não vale mais, não faz nada e devolve null. Lança se o banco falhar
 * (quem chama decide: o recebimento da mensagem segue sem unificar).
 */
export async function mergeContacts(workspaceId: string, aId: string, bId: string, opts: MergeOptions = {}): Promise<MergeResult | null> {
  if (aId === bId) return null
  const pre = await db.contact.findMany({ where: { workspaceId, id: { in: [aId, bId] } }, select: { telefone: true } })
  const lockPhone = opts.proof?.telefone ?? pre.find((c) => c.telefone)?.telefone ?? null

  const out = await db.$transaction(
    async (tx) => {
      if (lockPhone) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${workspaceId}:${lockPhone}`}))`
      // Linhas travadas em ordem fixa (sem impasse entre dois webhooks). Linha já apagada por quem veio antes não volta.
      const ids = [aId, bId].sort()
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Contact" WHERE "workspaceId" = ${workspaceId} AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`
      if (locked.length !== 2) return null
      if (opts.proof) {
        const pair = await proofPair(tx, workspaceId, opts.proof)
        if (!pair || ![pair.byLid.id, pair.byPhone.id].every((id) => ids.includes(id))) return null
      }
      const contacts = await tx.contact.findMany({ where: { id: { in: ids } } })
      if (contacts.length !== 2 || identifiersConflict(contacts[0], contacts[1])) return null
      const { keep, dup } = chooseKeep(contacts[0], contacts[1])

      const convs = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Conversation" WHERE "contactId" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`
      const keepConv = convs.length ? await tx.conversation.findUnique({ where: { contactId: keep.id } }) : null
      const dupConv = convs.length ? await tx.conversation.findUnique({ where: { contactId: dup.id } }) : null

      const r: MergeResult = {
        keepId: keep.id,
        dupId: dup.id,
        keepConversationId: keepConv?.id ?? dupConv?.id ?? null,
        removedConversationId: null,
        mensagensMovidas: 0,
        mensagensDescartadas: 0,
        aiJobsMovidos: 0,
        aiJobsCancelados: 0,
        followUpsMovidos: 0,
        followUpsCancelados: 0,
        eventosMovidos: 0,
        disparosMovidos: 0,
        disparosDescartados: 0,
        notificacoesAjustadas: 0,
      }

      if (keepConv && dupConv) {
        await mergeConversations(tx, keepConv, dupConv, r)
        r.removedConversationId = dupConv.id
      } else if (dupConv) {
        // Só o duplicado tinha conversa: ela passa a ser do contato mantido (mesmo id; a tela só atualiza).
        await tx.conversation.update({ where: { id: dupConv.id }, data: { contactId: keep.id } })
      }

      r.eventosMovidos = (await tx.event.updateMany({ where: { contactId: dup.id }, data: { contactId: keep.id } })).count
      // Disparo: um destinatário por campanha e contato; se os dois estavam na mesma campanha, fica o do mantido.
      const keepCampaigns = await tx.campaignRecipient.findMany({ where: { contactId: keep.id }, select: { campaignId: true } })
      if (keepCampaigns.length) {
        r.disparosDescartados = (
          await tx.campaignRecipient.deleteMany({ where: { contactId: dup.id, campaignId: { in: keepCampaigns.map((c) => c.campaignId) } } })
        ).count
      }
      r.disparosMovidos = (await tx.campaignRecipient.updateMany({ where: { contactId: dup.id }, data: { contactId: keep.id } })).count

      // O duplicado, já vazio, sai ANTES de o mantido receber o LID/telefone dele (únicos por espaço).
      await tx.contact.delete({ where: { id: dup.id } })
      await tx.contact.update({ where: { id: keep.id }, data: mergedContactData(keep, dup) })

      const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } })
      if (ws?.organizationId) {
        const { keepId, dupId, keepConversationId, removedConversationId, ...counts } = r
        await tx.auditLog.create({
          data: {
            organizationId: ws.organizationId,
            workspaceId,
            userId: null,
            acao: 'contato.unificado',
            alvo: keepId,
            meta: { keepId, dupId, keepConversationId, removedConversationId, origem: opts.origem ?? 'webhook', ...counts },
          },
        })
      }
      const orphanPhoto = keep.photoUrl && dup.photoUrl && keep.photoUrl !== dup.photoUrl ? contactPhotoIdFromUrl(dup.photoUrl) : null
      return { r, orphanPhoto }
    },
    { maxWait: 15_000, timeout: 30_000 },
  )
  if (!out) return null
  const { r, orphanPhoto } = out

  // Depois do commit: tela (lista de conversas) e arquivo da foto que ninguém mais usa. Nada disso pode desfazer a fusão.
  try {
    if (r.removedConversationId && r.keepConversationId) {
      emitToWorkspace(workspaceId, 'conversation.merged', { workspaceId, removedConversationId: r.removedConversationId, conversationId: r.keepConversationId })
    }
    if (r.keepConversationId) {
      const item = await loadConversationItem(workspaceId, r.keepConversationId)
      if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
    }
    if (orphanPhoto) await deleteContactPhoto(workspaceId, orphanPhoto)
  } catch (e) {
    logError('contatos', 'aviso pós-unificação falhou', e)
  }
  return r
}

/**
 * Chamado no recebimento (findOrCreateContact) quando o evento traz LID E telefone: unifica se houver prova.
 * Nunca lança: falha vira log e o recebimento segue como antes (a mensagem nunca se perde por causa disto).
 */
export async function unifyByProof(workspaceId: string, ref: ProofRef): Promise<MergeResult | null> {
  if (!ref.waUserId || !ref.telefone) return null
  try {
    const pair = await findMergeByProof(workspaceId, ref)
    if (!pair) return null
    return await mergeContacts(workspaceId, pair.keepId, pair.dupId, { proof: ref, origem: 'webhook' })
  } catch (e) {
    logError('contatos', 'unificação de contato falhou; mensagem segue no contato encontrado', e)
    return null
  }
}
