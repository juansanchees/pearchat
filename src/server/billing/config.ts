import type { Prisma } from '@prisma/client'

// Configuração da cobrança. BILLING_ENABLED=false (padrão) = o app se comporta como antes: sem trial, sem restrição,
// rotas de checkout respondem 409 BILLING_OFF.

export const billingEnabled = (): boolean => process.env.BILLING_ENABLED === 'true'
export const billingMock = (): boolean => process.env.BILLING_MOCK === 'true' && process.env.NODE_ENV !== 'production'

const intEnv = (name: string, def: number, min: number, max: number): number => {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}
export const trialDays = (): number => intEnv('TRIAL_DAYS', 7, 0, 90)
export const graceDays = (): number => intEnv('BILLING_GRACE_DAYS', 5, 0, 60)

export const DAY_MS = 86_400_000

/** Dados extras para `organization.create` de contas NOVAS: com cobrança ligada nasce em trial no Essencial. */
export function newOrganizationBilling(now = new Date()): Pick<Prisma.OrganizationUncheckedCreateInput, 'plano' | 'billingStatus' | 'trialAte'> | Record<string, never> {
  if (!billingEnabled()) return {}
  return { plano: 'ESSENCIAL', billingStatus: 'trial', trialAte: new Date(now.getTime() + trialDays() * DAY_MS) }
}

/** Data (YYYY-MM-DD) no fuso de São Paulo. */
export function spDate(d = new Date()): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
}
/** 'YYYY-MM-DD' do Asaas -> Date (meio-dia UTC, evita virar o dia em fusos). */
export function parseAsaasDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime())
  const day = r.getUTCDate()
  r.setUTCDate(1)
  r.setUTCMonth(r.getUTCMonth() + n)
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(day, last))
  return r
}

export class BillingError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}
