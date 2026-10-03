import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { CampaignListDTO, CampaignListId } from '@/lib/types'

export const LIST_IDS: CampaignListId[] = ['todos', 'clientes', 'aniv', 'frios']

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const FRIOS_DIAS = 30

/** Nome exibido de cada lista (aniversariantes seguem o mês corrente). */
export function listName(id: string, now: Date = new Date()): string {
  switch (id) {
    case 'todos':
      return 'Todos os contatos'
    case 'clientes':
      return 'Clientes que já compraram'
    case 'aniv':
      return `Aniversariantes de ${MESES[now.getMonth()]}`
    case 'frios':
      return 'Sem conversa há 30 dias'
    default:
      return id
  }
}

const LIST_DESC: Record<CampaignListId, string> = {
  todos: 'Toda a agenda sincronizada do WhatsApp',
  clientes: 'Pelo menos um pedido fechado',
  aniv: 'Data de aniversário no cadastro',
  frios: 'Contatos para reativar',
}

/**
 * Filtro base de destinatários de disparo: do workspace, sem opt-out e com um identificador para enviar
 * (telefone ou BSUID). A lista "aniv" precisa de filtro extra por mês, feito em JS (ver resolveRecipientIds).
 */
export function recipientWhere(workspaceId: string, lista: CampaignListId, now: Date = new Date()): Prisma.ContactWhereInput {
  const base: Prisma.ContactWhereInput = {
    workspaceId,
    optOut: false,
    OR: [{ telefone: { not: null } }, { waUserId: { not: null } }],
  }
  switch (lista) {
    case 'todos':
      return base
    case 'clientes':
      return { ...base, tags: { has: 'Cliente' } }
    case 'aniv':
      return { ...base, aniversario: { not: null } }
    case 'frios': {
      const corte = new Date(now.getTime() - FRIOS_DIAS * 24 * 60 * 60 * 1000)
      // Última atividade = última mensagem da conversa, ou o cadastro quando nunca houve conversa.
      return {
        AND: [
          base,
          {
            OR: [
              { conversation: { is: { lastMessageAt: { lt: corte } } } },
              { conversation: { is: { lastMessageAt: null } }, createdAt: { lt: corte } },
              { conversation: null, createdAt: { lt: corte } },
            ],
          },
        ],
      }
    }
  }
}

/**
 * IDs dos contatos que recebem um disparo para a lista. Sempre exclui optOut.
 * O worker de envio (próxima etapa) deve revalidar `optOut` no momento de cada envio.
 */
export async function resolveRecipientIds(workspaceId: string, lista: CampaignListId, now: Date = new Date()): Promise<string[]> {
  const where = recipientWhere(workspaceId, lista, now)
  if (lista === 'aniv') {
    // O ano do aniversário é placeholder (2000, UTC): só o mês importa.
    const rows = await db.contact.findMany({ where, select: { id: true, aniversario: true } })
    return rows.filter((r) => r.aniversario && r.aniversario.getUTCMonth() === now.getMonth()).map((r) => r.id)
  }
  const rows = await db.contact.findMany({ where, select: { id: true } })
  return rows.map((r) => r.id)
}

/** As 4 listas com a contagem real de destinatários. */
export async function getListsWithCounts(workspaceId: string, now: Date = new Date()): Promise<CampaignListDTO[]> {
  const counts = await Promise.all(LIST_IDS.map(async (id) => (await resolveRecipientIds(workspaceId, id, now)).length))
  return LIST_IDS.map((id, i) => ({ id, nome: listName(id, now), desc: LIST_DESC[id], qtd: counts[i] }))
}
