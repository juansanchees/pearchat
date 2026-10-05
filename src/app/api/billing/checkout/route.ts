import { z } from 'zod'
import { planFromName } from '@/lib/plans'
import type { PlanKey } from '@/lib/plans'
import { BillingError } from '@/server/billing/config'
import { billingRoute } from '@/server/billing/http'
import { BILLING_TYPES } from '@/server/billing/provider'
import type { BillingType } from '@/server/billing/provider'
import { startCheckout } from '@/server/billing/service'
import { readJson } from '@/server/http/body'

export const dynamic = 'force-dynamic'

// Só o NOME do plano e a forma de pagamento vêm do navegador. Preço, valor, organização e o novo plano efetivo
// vêm do servidor / do Asaas. O plano só muda quando o webhook confirmar o pagamento.
const schema = z.object({
  // Aceita a chave (PRO) ou o nome exibido (Pro, Negócios); qualquer outra coisa é recusada.
  plano: z.string().max(20).transform((v) => planFromName(v)).refine((v): v is PlanKey => v !== null),
  forma: z.enum(BILLING_TYPES as [string, ...string[]]),
  cpfCnpj: z.string().max(30).optional(),
})

export async function POST(req: Request) {
  const raw = await readJson(req)
  return billingRoute('billing.manage', async (actor) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new BillingError('Escolha o plano e a forma de pagamento.', 400, 'DADOS_INVALIDOS')
    return startCheckout(actor, { plano: parsed.data.plano, forma: parsed.data.forma as BillingType, cpfCnpj: parsed.data.cpfCnpj })
  })
}
