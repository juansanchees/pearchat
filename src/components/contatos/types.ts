export type Contact = {
  id: string
  name: string
  phone: string
  phoneDisplay: string
  email: string | null
  tags: string[]
  address: string | null
  birthday: string | null
  orders: number
  totalSpent: number
  customerSince: string | null
  notes: string
  optOut: boolean
  lastContactAt: string | null
  conversationId: string | null
}

export type ContactCounts = { todos: number; clientes: number; leads: number; vip: number }

export type ContactsPage = {
  items: Contact[]
  nextCursor: string | null
  total: number
  counts: ContactCounts
}

/** Valor enviado em `?tag=` (todos = sem parâmetro). */
export type ContactFilter = 'todos' | 'cliente' | 'lead' | 'vip'

export type ContactPatch = Partial<
  Pick<Contact, 'name' | 'email' | 'tags' | 'address' | 'birthday' | 'notes' | 'optOut'>
>

export type NewContactInput = { name: string; phone?: string; email?: string; tags?: string[] }

export type ImportResult = {
  criados: number
  atualizados: number
  ignorados: number
  erros: { linha: number; motivo: string }[]
}

export const TAG_OPTIONS = ['Lead', 'Cliente', 'VIP'] as const
