// Contrato JSON da tela Contatos (a UI depende destes tipos). Datas em ISO string ou null.
export type ContactDTO = {
  id: string
  name: string
  /** E.164, ex. "+5511987654321" ('' se o contato não tem telefone) */
  phone: string
  /** ex. "+55 11 98765-4321" */
  phoneDisplay: string
  email: string | null
  /** capitalizadas, ex. ["Cliente", "VIP"] */
  tags: string[]
  address: string | null
  /** ISO; o ano é irrelevante (só dia e mês importam) */
  birthday: string | null
  orders: number
  /** em reais */
  totalSpent: number
  customerSince: string | null
  notes: string
  optOut: boolean
  /** última mensagem da conversa; sem conversa, a data de cadastro */
  lastContactAt: string | null
  conversationId: string | null
  /** Foto do WhatsApp copiada pelo servidor (/api/contact-photo/<id>); null = só iniciais. */
  photoUrl: string | null
}

export type ContactCounts = { todos: number; clientes: number; leads: number; vip: number }

export type ContactListResponse = {
  items: ContactDTO[]
  nextCursor: string | null
  total: number
  counts: ContactCounts
}

export type ImportError = { linha: number; motivo: string }

export type ImportResult = {
  criados: number
  atualizados: number
  ignorados: number
  erros: ImportError[]
}
