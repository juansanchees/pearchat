import { ProviderError } from './provider'
import type { BillingProvider, ProviderPayment, ProviderSubscription } from './provider'

// Cliente HTTP do Asaas (API v3). Docs: https://docs.asaas.com
// - Autenticação: cabeçalho `access_token` (chave da conta). `User-Agent` obrigatório para contas novas.
// - Sandbox: https://api-sandbox.asaas.com ; produção: https://api.asaas.com (ASAAS_BASE_URL).
// - GET sem corpo. Novas tentativas SÓ em GET (POST repetido poderia duplicar cobrança).
// - Nunca registra a chave, o corpo das requisições nem dados pessoais.

const DEFAULT_BASE = 'https://api-sandbox.asaas.com'
const TIMEOUT_MS = 15_000
const GET_RETRIES = 2

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

function toPayment(o: Record<string, unknown>): ProviderPayment {
  return {
    id: String(o.id),
    customer: String(o.customer ?? ''),
    subscription: str(o.subscription),
    value: num(o.value),
    status: String(o.status ?? ''),
    billingType: str(o.billingType),
    dueDate: str(o.dueDate),
    paymentDate: str(o.paymentDate) ?? str(o.confirmedDate) ?? str(o.clientPaymentDate),
    invoiceUrl: str(o.invoiceUrl),
    externalReference: str(o.externalReference),
    description: str(o.description),
    deleted: o.deleted === true,
  }
}
function toSubscription(o: Record<string, unknown>): ProviderSubscription {
  return {
    id: String(o.id),
    customer: String(o.customer ?? ''),
    value: num(o.value),
    status: String(o.status ?? ''),
    nextDueDate: str(o.nextDueDate),
    deleted: o.deleted === true,
  }
}

export class AsaasProvider implements BillingProvider {
  private base: string
  constructor(private apiKey = process.env.ASAAS_API_KEY ?? '') {
    this.base = (process.env.ASAAS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
  }

  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
    if (!this.apiKey) throw new ProviderError('config')
    const attempts = method === 'GET' ? GET_RETRIES + 1 : 1
    let last: ProviderError = new ProviderError('unexpected')
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 400 * i))
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(`${this.base}${path}`, {
          method,
          headers: {
            access_token: this.apiKey,
            'User-Agent': 'PearChat/1.0',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (res.ok || res.status === 404) return { status: res.status, data }
        if (res.status === 401 || res.status === 403) throw new ProviderError('auth', res.status)
        if (res.status === 429) last = new ProviderError('rate', 429)
        else if (res.status >= 500) last = new ProviderError('server', res.status)
        else {
          // 400: validação. As descrições do Asaas ("CPF/CNPJ inválido") não trazem o valor enviado.
          const errs = Array.isArray(data.errors) ? (data.errors as { description?: unknown }[]) : []
          const detail = errs.map((e) => (typeof e.description === 'string' ? e.description : '')).filter(Boolean).join(' ').slice(0, 240)
          throw new ProviderError('validation', res.status, detail || undefined)
        }
      } catch (e) {
        if (e instanceof ProviderError) {
          if (!e.transient) throw e
          last = e
        } else {
          last = new ProviderError(e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network')
        }
      } finally {
        clearTimeout(timer)
      }
    }
    throw last
  }

  private must(r: { status: number; data: Record<string, unknown> }): Record<string, unknown> {
    if (r.status === 404 || typeof r.data.id !== 'string') throw new ProviderError('unexpected', r.status)
    return r.data
  }

  async createCustomer(i: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    const d = this.must(await this.call('POST', '/v3/customers', { ...i, notificationDisabled: false }))
    return { id: String(d.id) }
  }
  async createSubscription(i: Parameters<BillingProvider['createSubscription']>[0]) {
    return toSubscription(this.must(await this.call('POST', '/v3/subscriptions', { ...i, cycle: 'MONTHLY' })))
  }
  async updateSubscription(id: string, i: { value: number; updatePendingPayments: boolean }) {
    // Documentação: a atualização da assinatura é um POST em /v3/subscriptions/{id}.
    return toSubscription(this.must(await this.call('POST', `/v3/subscriptions/${encodeURIComponent(id)}`, i)))
  }
  async deleteSubscription(id: string) {
    await this.call('DELETE', `/v3/subscriptions/${encodeURIComponent(id)}`)
  }
  async getSubscription(id: string) {
    const r = await this.call('GET', `/v3/subscriptions/${encodeURIComponent(id)}`)
    return r.status === 404 ? null : toSubscription(this.must(r))
  }
  async listSubscriptionPayments(id: string) {
    const r = await this.call('GET', `/v3/subscriptions/${encodeURIComponent(id)}/payments?limit=20`)
    const list = Array.isArray(r.data.data) ? (r.data.data as Record<string, unknown>[]) : []
    return list.filter((p) => typeof p.id === 'string').map(toPayment)
  }
  async createPayment(i: Parameters<BillingProvider['createPayment']>[0]) {
    return toPayment(this.must(await this.call('POST', '/v3/payments', i)))
  }
  async getPayment(id: string) {
    const r = await this.call('GET', `/v3/payments/${encodeURIComponent(id)}`)
    return r.status === 404 ? null : toPayment(this.must(r))
  }
}
