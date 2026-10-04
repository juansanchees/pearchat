import { createHash, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { PLANS, planPrice } from '@/lib/plans'
import { audit } from '@/server/audit/log'
import { logError } from '@/server/engine/util'
import { getProvider } from './index'
import { addMonths, billingEnabled, DAY_MS, graceDays, parseAsaasDate } from './config'
import { fmtDateBR, sendBillingMail } from './emails'
import { invalidateEntitlements } from './entitlements'
import { overflowProblems } from './service'
import type { ProviderPayment } from './provider'

// Webhook do Asaas. Regras:
// 1) autenticado pelo cabeçalho asaas-access-token (comparação em tempo constante);
// 2) idempotente pelo id do evento (BillingEvent.asaasEventId único);
// 3) NUNCA confia só no corpo: consulta o pagamento/assinatura no Asaas pelo id antes de mudar qualquer estado;
// 4) o estado é derivado do status REAL consultado, então eventos repetidos, fora de ordem ou simultâneos não duplicam
//    nem regridem (a organização é travada com SELECT ... FOR UPDATE durante a atualização).

const PAID = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'])
const STALE_CLAIM_MS = 60_000

export function tokenOk(received: string | null): boolean {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN
  if (!expected || !received) return false
  const a = createHash('sha256').update(received).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export type AsaasEvent = { id?: unknown; event?: unknown; payment?: { id?: unknown }; subscription?: { id?: unknown } }
export type WebhookResult = { status: number; body: Record<string, unknown> }

export async function handleAsaasEvent(evt: AsaasEvent): Promise<WebhookResult> {
  const id = typeof evt.id === 'string' && evt.id.length > 0 && evt.id.length <= 120 ? evt.id : null
  const event = typeof evt.event === 'string' && evt.event.length <= 80 ? evt.event : null
  if (!id || !event) return { status: 400, body: { error: 'Evento inválido' } }
  if (!billingEnabled()) return { status: 200, body: { ok: true, ignorado: 'BILLING_OFF' } }

  const paymentId = typeof evt.payment?.id === 'string' ? evt.payment.id.slice(0, 80) : null
  const subscriptionId = typeof evt.subscription?.id === 'string' ? evt.subscription.id.slice(0, 80) : null
  try {
    await db.billingEvent.create({ data: { asaasEventId: id, tipo: event, resumo: { event, paymentId, subscriptionId } } })
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    const ex = await db.billingEvent.findUnique({ where: { asaasEventId: id }, select: { processadoEm: true } })
    if (ex?.processadoEm) return { status: 200, body: { ok: true, duplicado: true } }
    // Processamento anterior caiu no meio (ou ainda corre em outra requisição): só reassume se estiver parado.
    const claim = await db.billingEvent.updateMany({
      where: { asaasEventId: id, processadoEm: null, iniciadoEm: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      data: { iniciadoEm: new Date() },
    })
    if (claim.count === 0) return { status: 200, body: { ok: true, duplicado: true } }
  }

  try {
    const r = await processEvent(event, paymentId, subscriptionId)
    await db.billingEvent.update({ where: { asaasEventId: id }, data: { processadoEm: new Date(), organizationId: r.orgId ?? null } })
    return { status: 200, body: { ok: true, efeito: r.efeito } }
  } catch (e) {
    logError('billing', `evento ${event} falhou (o Asaas reenviará)`, e)
    return { status: 500, body: { error: 'Falha ao processar' } }
  }
}

async function processEvent(event: string, paymentId: string | null, subscriptionId: string | null): Promise<{ orgId?: string; efeito: string }> {
  const provider = getProvider()
  if (event.startsWith('PAYMENT_')) {
    if (!paymentId) return { efeito: 'ignorado' }
    const p = await provider.getPayment(paymentId)
    if (!p) {
      const inv = await db.billingInvoice.findUnique({ where: { asaasId: paymentId }, select: { organizationId: true } })
      if (!inv) return { efeito: 'ignorado' }
      await db.billingInvoice.updateMany({ where: { asaasId: paymentId }, data: { status: 'DELETED' } })
      return { orgId: inv.organizationId, efeito: 'fatura removida' }
    }
    return applyPayment(p)
  }
  if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    if (!subscriptionId) return { efeito: 'ignorado' }
    return applySubscriptionGone(subscriptionId)
  }
  return { efeito: 'ignorado' } // clientes, assinaturas criadas/alteradas, transferências etc.: sem efeito
}

async function applyPayment(p: ProviderPayment): Promise<{ orgId?: string; efeito: string }> {
  let org = p.subscription ? await db.organization.findUnique({ where: { asaasSubscriptionId: p.subscription } }) : null
  if (!org && p.customer) org = await db.organization.findUnique({ where: { asaasCustomerId: p.customer } })
  if (!org) return { efeito: 'ignorado (cliente desconhecido)' }
  if (org.asaasCustomerId && p.customer && p.customer !== org.asaasCustomerId) return { efeito: 'ignorado (outro cliente)' }

  const paid = PAID.has(p.status) && !p.deleted
  const isUpgrade = !!p.externalReference && p.externalReference === `upg:${org.planoPendente}`
  // Upgrade confirmado: a assinatura passa a cobrar o preço novo nos próximos ciclos (idempotente; falha = Asaas reenvia).
  if (paid && isUpgrade && org.asaasSubscriptionId && org.planoPendente) {
    await provider().updateSubscription(org.asaasSubscriptionId, { value: planPrice(org.planoPendente), updatePendingPayments: true })
  }

  const post: { restore?: number; mail?: () => void } = {}

  let efeito = 'fatura sincronizada'

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${org.id} FOR UPDATE`
    const o = await tx.organization.findUniqueOrThrow({ where: { id: org.id } })
    const prev = await tx.billingInvoice.findUnique({ where: { asaasId: p.id }, select: { status: true } })
    const wasPaid = !!prev && PAID.has(prev.status)
    const data = {
      valor: p.value,
      status: p.deleted ? 'DELETED' : p.status,
      vencimento: parseAsaasDate(p.dueDate),
      pagoEm: parseAsaasDate(p.paymentDate),
      invoiceUrl: p.invoiceUrl,
      assinaturaId: p.subscription,
      descricao: p.description?.slice(0, 200) ?? null,
    }
    await tx.billingInvoice.upsert({ where: { asaasId: p.id }, create: { asaasId: p.id, organizationId: o.id, ...data }, update: data })
    if (p.deleted) return
    const due = parseAsaasDate(p.dueDate)
    const patch: Prisma.OrganizationUpdateInput = {}

    if (paid) {
      if (wasPaid || o.billingStatus === 'cancelada' || o.billingStatus === 'isenta') return
      efeito = 'pagamento confirmado'
      let novoPlano = o.plano
      if (p.externalReference === `upg:${o.planoPendente}` && o.planoPendente) {
        novoPlano = o.planoPendente
        patch.planoPendente = null
        efeito = 'upgrade aplicado'
      } else if (p.subscription) {
        if (o.billingStatus !== 'ativa' && o.planoPendente) {
          novoPlano = o.planoPendente
          patch.planoPendente = null
        } else if (o.billingStatus === 'ativa' && o.planoAgendado && due && (!o.proximaCobranca || due.getTime() >= o.proximaCobranca.getTime() - 2 * DAY_MS)) {
          // Renovação: aplica o downgrade agendado se o uso ainda couber; senão mantém o plano e volta o preço da assinatura.
          const uso = await usageIn(tx, o.id)
          if (overflowProblems(uso, o.planoAgendado).length === 0) {
            novoPlano = o.planoAgendado
            efeito = 'downgrade aplicado'
          } else {
            post.restore = planPrice(o.plano)
          }
          patch.planoAgendado = null
        }
        if (due) {
          const fim = addMonths(due, 1)
          if (!o.proximaCobranca || fim > o.proximaCobranca) patch.proximaCobranca = fim
        }
      }
      patch.billingStatus = 'ativa'
      patch.atrasadaDesde = null
      if (novoPlano !== o.plano) patch.plano = novoPlano
      const alvoPlano = novoPlano
      const ate = (patch.proximaCobranca as Date | undefined) ?? o.proximaCobranca
      post.mail = () => void sendBillingMail(o.id, 'pagamento_confirmado', { plano: PLANS[alvoPlano].nome, ate: ate ? fmtDateBR(ate) : undefined })
      if (novoPlano !== o.plano) {
        const de = o.plano
        void audit({ organizationId: o.id, acao: 'plan.changed', alvo: PLANS[novoPlano].nome, meta: { de, para: novoPlano, origem: 'pagamento' } })
      }
    } else if (p.status === 'OVERDUE' && p.subscription) {
      // Só vale para a cobrança do ciclo atual (uma atrasada de ciclo já coberto por pagamento posterior não regride).
      const coberto = due && o.proximaCobranca && addMonths(due, 1).getTime() <= o.proximaCobranca.getTime()
      if (o.billingStatus === 'ativa' && !coberto) {
        patch.billingStatus = 'atrasada'
        patch.atrasadaDesde = due ?? new Date()
        efeito = 'assinatura atrasada'
        post.mail = () => void sendBillingMail(o.id, 'pagamento_atrasado', { graca: graceDays() })
      }
    } else if ((p.status === 'REFUNDED' || p.status === 'REFUND_REQUESTED') && wasPaid && p.subscription) {
      if (o.billingStatus === 'ativa' || o.billingStatus === 'atrasada') {
        patch.billingStatus = 'pendente'
        patch.proximaCobranca = new Date()
        efeito = 'pagamento estornado'
      }
    }
    if (Object.keys(patch).length) await tx.organization.update({ where: { id: o.id }, data: patch })
  }, { maxWait: 15_000, timeout: 20_000 }) // rajada de webhooks do mesmo cliente espera na fila do bloqueio da organização

  invalidateEntitlements(org.id)
  if (post.restore !== undefined && org.asaasSubscriptionId) {
    await provider().updateSubscription(org.asaasSubscriptionId, { value: post.restore, updatePendingPayments: true }).catch((e) => logError('billing', 'restaurar preço falhou', e))
  }
  post.mail?.()
  return { orgId: org.id, efeito }
}

const provider = getProvider

async function usageIn(tx: Prisma.TransactionClient, orgId: string): Promise<{ espacos: number; pessoas: number }> {
  const [espacos, users, pend] = await Promise.all([
    tx.workspace.count({ where: { organizationId: orgId, arquivadoEm: null } }),
    tx.user.count({ where: { organizationId: orgId, desativadoEm: null } }),
    tx.invite.count({ where: { organizationId: orgId, aceitoEm: null, revogadoEm: null, expiraEm: { gt: new Date() } } }),
  ])
  return { espacos, pessoas: users + pend }
}

async function applySubscriptionGone(subscriptionId: string): Promise<{ orgId?: string; efeito: string }> {
  const org = await db.organization.findUnique({ where: { asaasSubscriptionId: subscriptionId } })
  if (!org) return { efeito: 'ignorado (assinatura desconhecida)' }
  const sub = await provider().getSubscription(subscriptionId)
  if (sub && !sub.deleted && sub.status === 'ACTIVE') return { orgId: org.id, efeito: 'ignorado (assinatura ainda ativa)' }
  const r = await db.organization.updateMany({
    where: { id: org.id, asaasSubscriptionId: subscriptionId, billingStatus: { notIn: ['cancelada', 'isenta'] } },
    data: { billingStatus: 'cancelada', canceladaEm: new Date(), planoPendente: null, planoAgendado: null, atrasadaDesde: null },
  })
  invalidateEntitlements(org.id)
  if (r.count === 0) return { orgId: org.id, efeito: 'já cancelada' }
  await audit({ organizationId: org.id, acao: 'subscription.canceled', alvo: PLANS[org.plano].nome, meta: { origem: 'asaas' } })
  void sendBillingMail(org.id, 'assinatura_cancelada', { ate: org.proximaCobranca && org.proximaCobranca > new Date() ? fmtDateBR(org.proximaCobranca) : undefined })
  return { orgId: org.id, efeito: 'assinatura cancelada' }
}
