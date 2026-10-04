import { AsaasProvider } from './asaas'
import { billingMock } from './config'
import { MockBillingProvider } from './mock'
import type { BillingProvider } from './provider'

/** Provedor ativo: mock (BILLING_MOCK=true, fora de produção) ou Asaas. */
export function getProvider(): BillingProvider {
  return billingMock() ? new MockBillingProvider() : new AsaasProvider()
}
