import { z } from 'zod'
import { BillingError } from '@/server/billing/config'
import { billingRoute } from '@/server/billing/http'
import { BILLING_TYPES } from '@/server/billing/provider'
import type { BillingType } from '@/server/billing/provider'
import { reactivateSubscription } from '@/server/billing/service'
import { readJson } from '@/server/messages/api'

export const dynamic = 'force-dynamic'

const schema = z.object({ forma: z.enum(BILLING_TYPES as [string, ...string[]]) })

export async function POST(req: Request) {
  const raw = await readJson(req)
  return billingRoute('billing.manage', async (actor) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new BillingError('Escolha a forma de pagamento.', 400, 'DADOS_INVALIDOS')
    return reactivateSubscription(actor, parsed.data.forma as BillingType)
  })
}
