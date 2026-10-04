import { billingRoute } from '@/server/billing/http'
import { listInvoices } from '@/server/billing/service'

export const dynamic = 'force-dynamic'

// Faturas da PRÓPRIA organização (a invoiceUrl só é devolvida ao dono).
export async function GET() {
  return billingRoute('billing.view', async (actor) => ({ faturas: await listInvoices(actor.organizationId) }))
}
