import { db } from '@/lib/db'
import { billingEnabled, DAY_MS } from './config'
import { sendBillingMail } from './emails'

// Verificação diária da cobrança (chamada pelo scheduler a cada tick; roda de fato no máximo a cada 6 h).
// Hoje: aviso de "trial acabando" (3 dias antes), uma única vez por conta. Estados de pagamento vêm só do webhook.

const holder = globalThis as unknown as { __pearchat_billing_daily?: number }
const EVERY_MS = 6 * 3_600_000
const WARN_DAYS = 3

export async function runBillingDaily(now = new Date(), force = false): Promise<number> {
  if (!billingEnabled()) return 0
  if (!force && holder.__pearchat_billing_daily && now.getTime() - holder.__pearchat_billing_daily < EVERY_MS) return 0
  holder.__pearchat_billing_daily = now.getTime()
  const orgs = await db.organization.findMany({
    where: { billingStatus: 'trial', avisoTrialEm: null, trialAte: { gt: now, lte: new Date(now.getTime() + WARN_DAYS * DAY_MS) } },
    select: { id: true, trialAte: true },
    take: 200,
  })
  let sent = 0
  for (const o of orgs) {
    // Reivindica antes de enviar: duas instâncias não mandam o mesmo aviso duas vezes.
    const claim = await db.organization.updateMany({ where: { id: o.id, avisoTrialEm: null }, data: { avisoTrialEm: now } })
    if (claim.count !== 1) continue
    const dias = Math.max(1, Math.ceil((o.trialAte!.getTime() - now.getTime()) / DAY_MS))
    if (await sendBillingMail(o.id, 'trial_acabando', { dias })) sent++
  }
  return sent
}
