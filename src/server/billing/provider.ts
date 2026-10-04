// Interface do provedor de cobrança. Implementações: Asaas (asaas.ts) e MockBillingProvider (mock.ts, BILLING_MOCK=true).
// Nenhum dado de cartão passa por aqui: o pagamento acontece na página hospedada (invoiceUrl).

export type BillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD'
export const BILLING_TYPES: BillingType[] = ['PIX', 'BOLETO', 'CREDIT_CARD']

export type ProviderPayment = {
  id: string
  customer: string
  subscription: string | null
  value: number
  status: string // PENDING | RECEIVED | CONFIRMED | OVERDUE | REFUNDED | RECEIVED_IN_CASH | ...
  billingType: string | null
  dueDate: string | null // YYYY-MM-DD
  paymentDate: string | null
  invoiceUrl: string | null
  externalReference: string | null
  description: string | null
  deleted: boolean
}

export type ProviderSubscription = {
  id: string
  customer: string
  value: number
  status: string // ACTIVE | INACTIVE | EXPIRED
  nextDueDate: string | null
  deleted: boolean
}

export interface BillingProvider {
  createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }): Promise<{ id: string }>
  createSubscription(input: {
    customer: string
    billingType: BillingType
    value: number
    nextDueDate: string
    description: string
    externalReference: string
  }): Promise<ProviderSubscription>
  updateSubscription(id: string, input: { value: number; updatePendingPayments: boolean }): Promise<ProviderSubscription>
  /** Cancela de vez. 404/já removida não é erro. */
  deleteSubscription(id: string): Promise<void>
  /** null = não existe mais (404). */
  getSubscription(id: string): Promise<ProviderSubscription | null>
  listSubscriptionPayments(id: string): Promise<ProviderPayment[]>
  createPayment(input: {
    customer: string
    billingType: BillingType
    value: number
    dueDate: string
    description: string
    externalReference: string
  }): Promise<ProviderPayment>
  /** null = não existe (404). */
  getPayment(id: string): Promise<ProviderPayment | null>
}

export type BillingErrorKind = 'config' | 'network' | 'timeout' | 'auth' | 'validation' | 'rate' | 'server' | 'unexpected'

/** Erro tipado do provedor. A mensagem nunca contém chave nem dados pessoais. */
export class ProviderError extends Error {
  constructor(
    public kind: BillingErrorKind,
    public status?: number,
    /** Descrições de validação devolvidas pelo Asaas (texto curto, sem dados pessoais) para mostrar ao usuário. */
    public detail?: string,
  ) {
    super(`billing-provider:${kind}${status ? `:${status}` : ''}`)
    this.name = 'ProviderError'
  }
  /** Pode tentar de novo mais tarde (o webhook responde 5xx para o Asaas reenviar). */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'rate' || this.kind === 'server'
  }
}
