import { randomBytes } from 'node:crypto'
import { addMonths, parseAsaasDate } from './config'
import type { BillingProvider, ProviderPayment, ProviderSubscription } from './provider'

// Provedor falso em memória (BILLING_MOCK=true, nunca em produção). Para desenvolver a interface sem conta no Asaas.
// Os testes de integração usam o Asaas FALSO HTTP (.claude/tmp/etapa-pagamentos/fake-asaas.mjs), que exercita o cliente real.

type Store = { customers: Map<string, string>; subs: Map<string, ProviderSubscription>; pays: Map<string, ProviderPayment> }
const g = globalThis as unknown as { __pearchat_billing_mock?: Store }
const store = (g.__pearchat_billing_mock ??= { customers: new Map(), subs: new Map(), pays: new Map() })
const rid = (p: string) => `${p}_${randomBytes(6).toString('hex')}`

export class MockBillingProvider implements BillingProvider {
  async createCustomer(i: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    const id = rid('cus')
    store.customers.set(id, i.externalReference)
    return { id }
  }
  async createSubscription(i: Parameters<BillingProvider['createSubscription']>[0]) {
    const sub: ProviderSubscription = { id: rid('sub'), customer: i.customer, value: i.value, status: 'ACTIVE', nextDueDate: i.nextDueDate, deleted: false }
    store.subs.set(sub.id, sub)
    const pay: ProviderPayment = {
      id: rid('pay'),
      customer: i.customer,
      subscription: sub.id,
      value: i.value,
      status: 'PENDING',
      billingType: i.billingType,
      dueDate: i.nextDueDate,
      paymentDate: null,
      invoiceUrl: `https://sandbox.asaas.invalid/i/${rid('inv')}`,
      externalReference: null,
      description: i.description,
      deleted: false,
    }
    store.pays.set(pay.id, pay)
    const next = parseAsaasDate(i.nextDueDate)
    if (next) sub.nextDueDate = addMonths(next, 1).toISOString().slice(0, 10)
    return sub
  }
  async updateSubscription(id: string, i: { value: number }) {
    const s = store.subs.get(id)
    if (!s) throw new Error('mock: assinatura inexistente')
    s.value = i.value
    return s
  }
  async deleteSubscription(id: string) {
    const s = store.subs.get(id)
    if (s) {
      s.deleted = true
      s.status = 'INACTIVE'
    }
  }
  async getSubscription(id: string) {
    return store.subs.get(id) ?? null
  }
  async listSubscriptionPayments(id: string) {
    return Array.from(store.pays.values()).filter((p) => p.subscription === id)
  }
  async createPayment(i: Parameters<BillingProvider['createPayment']>[0]) {
    const pay: ProviderPayment = {
      id: rid('pay'),
      customer: i.customer,
      subscription: null,
      value: i.value,
      status: 'PENDING',
      billingType: i.billingType,
      dueDate: i.dueDate,
      paymentDate: null,
      invoiceUrl: `https://sandbox.asaas.invalid/i/${rid('inv')}`,
      externalReference: i.externalReference,
      description: i.description,
      deleted: false,
    }
    store.pays.set(pay.id, pay)
    return pay
  }
  async getPayment(id: string) {
    return store.pays.get(id) ?? null
  }
}

/** Só para desenvolvimento: marca uma cobrança do mock como paga. */
export function mockMarkPaid(paymentId: string): boolean {
  const p = store.pays.get(paymentId)
  if (!p) return false
  p.status = 'CONFIRMED'
  p.paymentDate = new Date().toISOString().slice(0, 10)
  return true
}
