import type { Contact, Conversation } from '@prisma/client'
import { formatPhoneDisplay } from './phone'
import type { ContactDTO } from './types'

export const contactInclude = {
  conversation: { select: { id: true, lastMessageAt: true } },
} as const

export type ContactRow = Contact & {
  conversation: Pick<Conversation, 'id' | 'lastMessageAt'> | null
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function toContactDTO(c: ContactRow): ContactDTO {
  const phone = c.telefone ?? ''
  return {
    id: c.id,
    name: c.nome,
    phone,
    phoneDisplay: formatPhoneDisplay(c.telefone),
    email: c.email,
    tags: c.tags,
    address: c.endereco,
    birthday: iso(c.aniversario),
    orders: c.pedidos,
    totalSpent: c.totalGasto.toNumber(),
    customerSince: iso(c.clienteDesde),
    notes: c.notas ?? '',
    optOut: c.optOut,
    lastContactAt: iso(c.conversation?.lastMessageAt ?? c.createdAt),
    conversationId: c.conversation?.id ?? null,
    photoUrl: c.photoUrl,
  }
}
