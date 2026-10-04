import type { Organization } from '@prisma/client'
import { db } from '@/lib/db'
import { PLANS, PLAN_KEYS, PLAN_RANK, planPrice } from '@/lib/plans'
import type { PlanKey } from '@/lib/plans'
import { audit } from '@/server/audit/log'
import { getProvider } from './index'
import { BillingError, billingEnabled, parseAsaasDate, spDate } from './config'
import { maskCpfCnpj, openCpfCnpj, parseCpfCnpj, sealCpfCnpj } from './cpf'
import { sendBillingMail, fmtDateBR } from './emails'
import { entitlements, invalidateEntitlements } from './entitlements'
import { ProviderError } from './provider'
import type { BillingType, ProviderPayment } from './provider'

// Fluxos de cobrança iniciados pelo DONO (billing.manage). O id da organização vem SEMPRE da sessão; plano e valor
// nunca vêm do navegador como verdade: o plano só muda quando o Asaas confirma o pagamento (webhook.ts).

export type Actor = { organizationId: string; userId: string }

const holder = globalThis as unknown as { __pearchat_billing_locks?: Map<string, Promise<unknown>> }
const locks = (holder.__pearchat_billing_locks ??= new Map())
/** Uma operação de cobrança por organização por vez (neste processo). A corrida entre processos é coberta por updates condicionais. */
async function withOrgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(orgId) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(fn)
  locks.set(orgId, run)
  try {
    return await run
  } finally {
    if (locks.get(orgId) === run) locks.delete(orgId)
  }
}

export function requireBilling(): void {
  if (!billingEnabled()) throw new BillingError('A cobrança não está ativa neste ambiente.', 409, 'BILLING_OFF')
}

/** Converte falhas do provedor em erros de API sem vazar detalhes. */
async function gw<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ProviderError) {
      if (e.kind === 'validation') throw new BillingError(e.detail ? `O Asaas recusou os dados: ${e.detail}` : 'O Asaas recusou os dados informados.', 422, 'GATEWAY_RECUSOU')
      if (e.kind === 'config' || e.kind === 'auth') throw new BillingError('O pagamento ainda não está configurado neste ambiente.', 503, 'GATEWAY_CONFIG')
      throw new BillingError('Não foi possível falar com o serviço de pagamento agora. Tente novamente em instantes.', 502, 'GATEWAY_INDISPONIVEL')
    }
    throw e
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function loadOrg(id: string): Promise<Organization> {
  return db.organization.findUniqueOrThrow({ where: { id } })
}

export async function upsertInvoice(orgId: string, p: ProviderPayment): Promise<void> {
  const data = {
    valor: p.value,
    status: p.deleted ? 'DELETED' : p.status,
    vencimento: parseAsaasDate(p.dueDate),
    pagoEm: parseAsaasDate(p.paymentDate),
    invoiceUrl: p.invoiceUrl,
    assinaturaId: p.subscription,
    descricao: p.description?.slice(0, 200) ?? null,
  }
  await db.billingInvoice.upsert({ where: { asaasId: p.id }, create: { asaasId: p.id, organizationId: orgId, ...data }, update: data })
}

async function ensureCustomer(org: Organization, cpfInput: unknown, email: string): Promise<string> {
  if (org.asaasCustomerId) return org.asaasCustomerId
  const doc = parseCpfCnpj(typeof cpfInput === 'string' && cpfInput.trim() ? cpfInput : openCpfCnpj(org.cpfCnpj))
  if (!doc) throw new BillingError('Informe um CPF ou CNPJ válido.', 400, 'CPF_INVALIDO')
  const c = await gw(() => getProvider().createCustomer({ name: org.nome.slice(0, 100), cpfCnpj: doc, email, externalReference: org.id }))
  const r = await db.organization.updateMany({ where: { id: org.id, asaasCustomerId: null }, data: { asaasCustomerId: c.id, cpfCnpj: sealCpfCnpj(doc) } })
  if (r.count === 0) return (await loadOrg(org.id)).asaasCustomerId ?? c.id
  return c.id
}

/** Uso atual da conta, para decidir se um plano menor comporta. */
export async function currentUsage(orgId: string): Promise<{ espacos: number; pessoas: number }> {
  const [espacos, users, pend] = await Promise.all([
    db.workspace.count({ where: { organizationId: orgId, arquivadoEm: null } }),
    db.user.count({ where: { organizationId: orgId, desativadoEm: null } }),
    db.invite.count({ where: { organizationId: orgId, aceitoEm: null, revogadoEm: null, expiraEm: { gt: new Date() } } }),
  ])
  return { espacos, pessoas: users + pend }
}

/** Texto do que precisa ser reduzido para caber no plano. Vazio = cabe. */
export function overflowProblems(uso: { espacos: number; pessoas: number }, alvo: PlanKey): string[] {
  const p: string[] = []
  const d = PLANS[alvo]
  if (uso.espacos > d.espacos) p.push(`WhatsApps: você tem ${uso.espacos} e o plano ${d.nome} permite ${d.espacos}`)
  if (uso.pessoas > d.pessoas) p.push(`Pessoas: você tem ${uso.pessoas} (contando convites pendentes) e o plano ${d.nome} permite ${d.pessoas}`)
  return p
}

export type CheckoutInput = { plano: PlanKey; forma: BillingType; cpfCnpj?: string }
export type CheckoutResult = {
  tipo: 'nova' | 'upgrade' | 'downgrade' | 'downgrade_cancelado'
  plano: string
  invoiceUrl: string | null
  agendadoPara?: string | null
}

async function ownerEmail(orgId: string): Promise<string> {
  const o = await db.user.findFirst({ where: { organizationId: orgId, papel: 'owner', desativadoEm: null }, orderBy: { createdAt: 'asc' }, select: { email: true } })
  if (!o) throw new BillingError('Conta sem responsável.', 409, 'SEM_DONO')
  return o.email
}

export function startCheckout(actor: Actor, input: CheckoutInput): Promise<CheckoutResult> {
  requireBilling()
  return withOrgLock(actor.organizationId, () => startCheckoutLocked(actor, input))
}

async function startCheckoutLocked(actor: Actor, input: CheckoutInput): Promise<CheckoutResult> {
  const org = await loadOrg(actor.organizationId)
  const alvo = input.plano
  const now = new Date()
  const provider = getProvider()
  if (org.billingStatus === 'isenta') throw new BillingError('Sua conta é isenta de cobrança.', 409, 'ISENTA')

  if (org.billingStatus === 'atrasada') {
    const inv = await db.billingInvoice.findFirst({ where: { organizationId: org.id, status: 'OVERDUE' }, orderBy: { vencimento: 'desc' } })
    throw new BillingError('Há uma fatura em atraso. Pague-a para poder trocar de plano.', 409, 'ATRASADA', { invoiceUrl: inv?.invoiceUrl ?? null })
  }

  if (org.billingStatus === 'ativa' && org.asaasSubscriptionId && org.asaasCustomerId) {
    if (alvo === org.plano) {
      if (org.planoAgendado) {
        await gw(() => provider.updateSubscription(org.asaasSubscriptionId!, { value: planPrice(org.plano), updatePendingPayments: true }))
        await db.organization.update({ where: { id: org.id }, data: { planoAgendado: null } })
        invalidateEntitlements(org.id)
        return { tipo: 'downgrade_cancelado', plano: PLANS[alvo].nome, invoiceUrl: null }
      }
      throw new BillingError('Este já é o seu plano.', 409, 'JA_NO_PLANO')
    }
    if (PLAN_RANK[alvo] > PLAN_RANK[org.plano]) {
      // Upgrade: cobrança avulsa da diferença do mês. O plano muda quando o Asaas confirmar (webhook).
      const diff = round2(planPrice(alvo) - planPrice(org.plano))
      if (diff < 5) throw new BillingError('Não foi possível calcular a diferença do plano. Fale com o suporte.', 409, 'DIFERENCA_INVALIDA')
      const pay = await gw(() =>
        provider.createPayment({
          customer: org.asaasCustomerId!,
          billingType: input.forma,
          value: diff,
          dueDate: spDate(now),
          description: `PearChat: upgrade para ${PLANS[alvo].nome} (diferença do mês)`,
          externalReference: `upg:${alvo}`,
        }),
      )
      await db.organization.update({ where: { id: org.id }, data: { planoPendente: alvo } })
      await upsertInvoice(org.id, pay)
      return { tipo: 'upgrade', plano: PLANS[alvo].nome, invoiceUrl: pay.invoiceUrl }
    }
    // Downgrade: só no próximo ciclo e só se o uso atual couber.
    const problemas = overflowProblems(await currentUsage(org.id), alvo)
    if (problemas.length) {
      throw new BillingError(`Para mudar para o plano ${PLANS[alvo].nome}, reduza antes: ${problemas.join('; ')}.`, 422, 'USO_EXCEDE', { problemas })
    }
    await gw(() => provider.updateSubscription(org.asaasSubscriptionId!, { value: planPrice(alvo), updatePendingPayments: true }))
    await db.organization.update({ where: { id: org.id }, data: { planoAgendado: alvo } })
    invalidateEntitlements(org.id)
    return { tipo: 'downgrade', plano: PLANS[alvo].nome, invoiceUrl: null, agendadoPara: org.proximaCobranca?.toISOString() ?? null }
  }

  if (org.billingStatus === 'cancelada' && org.proximaCobranca && org.proximaCobranca > now) {
    throw new BillingError('Sua assinatura está cancelada, mas ainda vale até o fim do período. Use "Reativar".', 409, 'USE_REATIVAR')
  }

  // Nova assinatura (trial, pendente sem pagamento ou cancelada já vencida).
  const customer = await ensureCustomer(org, input.cpfCnpj, await ownerEmail(org.id))
  const trialValido = !!org.trialAte && org.trialAte > now
  const due = trialValido && spDate(org.trialAte!) > spDate(now) ? spDate(org.trialAte!) : spDate(now)
  const sub = await gw(() =>
    provider.createSubscription({
      customer,
      billingType: input.forma,
      value: planPrice(alvo),
      nextDueDate: due,
      description: `PearChat ${PLANS[alvo].nome}`,
      externalReference: org.id,
    }),
  )
  const claim = await db.organization.updateMany({
    where: { id: org.id, asaasSubscriptionId: org.asaasSubscriptionId },
    data: { asaasSubscriptionId: sub.id, planoPendente: alvo, planoAgendado: null, billingStatus: 'pendente', canceladaEm: null, atrasadaDesde: null },
  })
  if (claim.count === 0) {
    await provider.deleteSubscription(sub.id).catch(() => undefined)
    throw new BillingError('Outra contratação estava em andamento. Tente de novo.', 409, 'CONCORRENCIA')
  }
  if (org.asaasSubscriptionId) {
    await provider.deleteSubscription(org.asaasSubscriptionId).catch(() => undefined)
    await db.billingInvoice.updateMany({ where: { organizationId: org.id, assinaturaId: org.asaasSubscriptionId, status: 'PENDING' }, data: { status: 'DELETED' } })
  }
  invalidateEntitlements(org.id)
  const pays = await gw(() => provider.listSubscriptionPayments(sub.id)).catch(() => [] as ProviderPayment[])
  for (const p of pays) await upsertInvoice(org.id, p)
  const first = [...pays].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]
  await audit({ organizationId: org.id, userId: actor.userId, acao: 'subscription.created', alvo: PLANS[alvo].nome, meta: { plano: alvo, forma: input.forma } })
  return { tipo: 'nova', plano: PLANS[alvo].nome, invoiceUrl: first?.invoiceUrl ?? null }
}

export function cancelSubscription(actor: Actor): Promise<{ ate: string | null }> {
  requireBilling()
  return withOrgLock(actor.organizationId, async () => {
    const org = await loadOrg(actor.organizationId)
    if (!org.asaasSubscriptionId || org.billingStatus === 'cancelada' || org.billingStatus === 'isenta') {
      throw new BillingError('Não há assinatura para cancelar.', 409, 'SEM_ASSINATURA')
    }
    await gw(() => getProvider().deleteSubscription(org.asaasSubscriptionId!))
    const now = new Date()
    await db.organization.update({
      where: { id: org.id },
      data: { billingStatus: 'cancelada', canceladaEm: now, planoPendente: null, planoAgendado: null, atrasadaDesde: null },
    })
    await db.billingInvoice.updateMany({ where: { organizationId: org.id, assinaturaId: org.asaasSubscriptionId, status: { in: ['PENDING', 'OVERDUE'] } }, data: { status: 'DELETED' } })
    invalidateEntitlements(org.id)
    await audit({ organizationId: org.id, userId: actor.userId, acao: 'subscription.canceled', alvo: PLANS[org.plano].nome })
    const ate = org.proximaCobranca && org.proximaCobranca > now ? org.proximaCobranca : null
    void sendBillingMail(org.id, 'assinatura_cancelada', { ate: ate ? fmtDateBR(ate) : undefined })
    return { ate: ate?.toISOString() ?? null }
  })
}

export function reactivateSubscription(actor: Actor, forma: BillingType): Promise<{ ok: true }> {
  requireBilling()
  return withOrgLock(actor.organizationId, async () => {
    const org = await loadOrg(actor.organizationId)
    const now = new Date()
    if (org.billingStatus !== 'cancelada') throw new BillingError('A assinatura não está cancelada.', 409, 'NAO_CANCELADA')
    if (!org.proximaCobranca || org.proximaCobranca <= now || !org.asaasCustomerId) {
      throw new BillingError('O período pago terminou. Escolha um plano para voltar.', 409, 'ESCOLHA_PLANO')
    }
    const sub = await gw(() =>
      getProvider().createSubscription({
        customer: org.asaasCustomerId!,
        billingType: forma,
        value: planPrice(org.plano),
        nextDueDate: spDate(org.proximaCobranca!),
        description: `PearChat ${PLANS[org.plano].nome}`,
        externalReference: org.id,
      }),
    )
    const claim = await db.organization.updateMany({
      where: { id: org.id, billingStatus: 'cancelada' },
      data: { asaasSubscriptionId: sub.id, billingStatus: 'ativa', canceladaEm: null },
    })
    if (claim.count === 0) {
      await getProvider().deleteSubscription(sub.id).catch(() => undefined)
      throw new BillingError('A assinatura mudou enquanto você reativava. Atualize e tente de novo.', 409, 'CONCORRENCIA')
    }
    invalidateEntitlements(org.id)
    await audit({ organizationId: org.id, userId: actor.userId, acao: 'subscription.reactivated', alvo: PLANS[org.plano].nome })
    return { ok: true }
  })
}

export type InvoiceDTO = { id: string; valor: number; status: string; vencimento: string | null; pagoEm: string | null; invoiceUrl: string | null }

/** Faturas da PRÓPRIA organização (invoiceUrl só sai por aqui, para o dono). Completa a fatura recém-criada se o Asaas demorou a gerá-la. */
export async function listInvoices(orgId: string): Promise<InvoiceDTO[]> {
  const org = await loadOrg(orgId)
  if (billingEnabled() && org.asaasSubscriptionId && org.billingStatus === 'pendente') {
    const has = await db.billingInvoice.count({ where: { organizationId: orgId, assinaturaId: org.asaasSubscriptionId, status: 'PENDING', invoiceUrl: { not: null } } })
    if (!has) {
      const pays = await getProvider().listSubscriptionPayments(org.asaasSubscriptionId).catch(() => [] as ProviderPayment[])
      for (const p of pays) await upsertInvoice(orgId, p)
    }
  }
  const rows = await db.billingInvoice.findMany({ where: { organizationId: orgId, status: { not: 'DELETED' } }, orderBy: [{ vencimento: 'desc' }, { createdAt: 'desc' }], take: 24 })
  return rows.map((r) => ({
    id: r.id,
    valor: Number(r.valor),
    status: r.status,
    vencimento: r.vencimento?.toISOString() ?? null,
    pagoEm: r.pagoEm?.toISOString() ?? null,
    invoiceUrl: r.invoiceUrl,
  }))
}

export type CobrancaDTO = {
  ativo: true
  status: string
  restrito: boolean
  motivo: string | null
  trialDias: number | null
  trialAte: string | null
  proximaCobranca: string | null
  canceladaEm: string | null
  planoPendente: string | null
  planoAgendado: string | null
  temAssinatura: boolean
  documento: string | null
  precos: Record<string, number>
  faturas: InvoiceDTO[]
}

/** Bloco "cobranca" do GET /api/billing (só dono). null = cobrança desligada. */
export async function getCobranca(orgId: string): Promise<CobrancaDTO | null> {
  if (!billingEnabled()) return null
  const [org, ent, faturas] = await Promise.all([loadOrg(orgId), entitlements(orgId), listInvoices(orgId)])
  return {
    ativo: true,
    status: org.billingStatus,
    restrito: ent.restrito,
    motivo: ent.motivo,
    trialDias: ent.trialDiasRestantes,
    trialAte: org.trialAte?.toISOString() ?? null,
    proximaCobranca: org.proximaCobranca?.toISOString() ?? null,
    canceladaEm: org.canceladaEm?.toISOString() ?? null,
    planoPendente: org.planoPendente ? PLANS[org.planoPendente].nome : null,
    planoAgendado: org.planoAgendado ? PLANS[org.planoAgendado].nome : null,
    temAssinatura: !!org.asaasSubscriptionId && org.billingStatus !== 'cancelada',
    documento: openCpfCnpj(org.cpfCnpj) ? maskCpfCnpj(openCpfCnpj(org.cpfCnpj) as string) : null,
    precos: Object.fromEntries(PLAN_KEYS.map((k) => [PLANS[k].nome, planPrice(k)])),
    faturas,
  }
}

/** Estado mínimo para a faixa de aviso (qualquer papel; sem valores nem ids). */
export async function getBillingBanner(orgId: string): Promise<{ ativo: boolean; status?: string; restrito?: boolean; motivo?: string | null; trialDias?: number | null }> {
  if (!billingEnabled()) return { ativo: false }
  const ent = await entitlements(orgId)
  return { ativo: true, status: ent.status ?? undefined, restrito: ent.restrito, motivo: ent.motivo, trialDias: ent.trialDiasRestantes }
}
