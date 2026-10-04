import { billingRoute } from '@/server/billing/http'
import { cancelSubscription } from '@/server/billing/service'

export const dynamic = 'force-dynamic'

// Cancela a assinatura; o acesso continua até o fim do período já pago.
export async function POST() {
  return billingRoute('billing.manage', (actor) => cancelSubscription(actor))
}
