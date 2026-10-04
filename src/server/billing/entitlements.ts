import { db } from '@/lib/db'
import { billingEnabled, DAY_MS, graceDays } from './config'

// Função única de direitos da conta. Com cobrança desligada (padrão) devolve SEMPRE "sem restrição" — o app se
// comporta exatamente como antes. Modo restrito NUNCA bloqueia receber mensagens nem a resposta manual: bloqueia só
// o que o sistema faz sozinho (IA, follow-up, disparos, lembretes) e o crescimento (criar espaço, convidar pessoa).

export type BillingStatus = 'trial' | 'ativa' | 'pendente' | 'atrasada' | 'cancelada' | 'isenta'
export type RestrictMotivo = 'trial_vencido' | 'atrasada' | 'cancelada' | 'sem_pagamento'

export type Entitlements = {
  /** false = cobrança desligada neste servidor. */
  billing: boolean
  status: BillingStatus | null
  restrito: boolean
  motivo: RestrictMotivo | null
  trialDiasRestantes: number | null
  /** IA, follow-up, disparos e lembretes automáticos. */
  podeAutomatizar: boolean
  podeCriarEspaco: boolean
  podeConvidar: boolean
}

export type OrgBillingRow = {
  billingStatus: string
  trialAte: Date | null
  proximaCobranca: Date | null
  atrasadaDesde: Date | null
}

const OPEN: Entitlements = { billing: false, status: null, restrito: false, motivo: null, trialDiasRestantes: null, podeAutomatizar: true, podeCriarEspaco: true, podeConvidar: true }

/** Cálculo puro (testável). */
export function computeEntitlements(org: OrgBillingRow, now: Date = new Date(), grace = graceDays()): Entitlements {
  const status = (['trial', 'ativa', 'pendente', 'atrasada', 'cancelada', 'isenta'].includes(org.billingStatus) ? org.billingStatus : 'isenta') as BillingStatus
  const trialValido = !!org.trialAte && org.trialAte.getTime() > now.getTime()
  const trialDias = org.trialAte ? Math.max(0, Math.ceil((org.trialAte.getTime() - now.getTime()) / DAY_MS)) : null
  const periodoPago = !!org.proximaCobranca && org.proximaCobranca.getTime() > now.getTime()
  const base = { billing: true, status, trialDiasRestantes: status === 'trial' || status === 'pendente' ? trialDias : null }
  const ok = (): Entitlements => ({ ...base, restrito: false, motivo: null, podeAutomatizar: true, podeCriarEspaco: true, podeConvidar: true })
  const bloqueado = (motivo: RestrictMotivo): Entitlements => ({ ...base, restrito: true, motivo, podeAutomatizar: false, podeCriarEspaco: false, podeConvidar: false })

  switch (status) {
    case 'isenta':
    case 'ativa':
      return ok()
    case 'trial':
      return trialValido ? ok() : bloqueado('trial_vencido')
    case 'pendente':
      // Contratou e ainda não pagou: vale o que já tinha (teste ou período pago).
      return trialValido || periodoPago ? ok() : bloqueado(org.trialAte ? 'trial_vencido' : 'sem_pagamento')
    case 'atrasada': {
      const desde = org.atrasadaDesde ?? org.proximaCobranca ?? now
      return now.getTime() < desde.getTime() + grace * DAY_MS || periodoPago ? ok() : bloqueado('atrasada')
    }
    case 'cancelada':
      return periodoPago || trialValido ? ok() : bloqueado('cancelada')
  }
}

const TTL_MS = 15_000
const holder = globalThis as unknown as { __pearchat_ent_cache?: Map<string, { v: Entitlements; exp: number }>; __pearchat_ent_ws?: Map<string, { orgId: string | null; exp: number }> }
const cache = (holder.__pearchat_ent_cache ??= new Map())
const wsOrg = (holder.__pearchat_ent_ws ??= new Map())

/** Chamar depois de qualquer mudança de estado da cobrança. */
export function invalidateEntitlements(orgId?: string): void {
  if (orgId) cache.delete(orgId)
  else cache.clear()
}

export async function entitlements(orgId: string): Promise<Entitlements> {
  if (!billingEnabled()) return OPEN
  const hit = cache.get(orgId)
  if (hit && hit.exp > Date.now()) return hit.v
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { billingStatus: true, trialAte: true, proximaCobranca: true, atrasadaDesde: true } })
  const v = org ? computeEntitlements(org) : OPEN
  cache.set(orgId, { v, exp: Date.now() + TTL_MS })
  return v
}

/** Para o motor, que trabalha por workspace. Workspace sem organização = conta legada = sem restrição. */
export async function entitlementsForWorkspace(workspaceId: string): Promise<Entitlements> {
  if (!billingEnabled()) return OPEN
  let hit = wsOrg.get(workspaceId)
  if (!hit || hit.exp < Date.now()) {
    const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } })
    hit = { orgId: ws?.organizationId ?? null, exp: Date.now() + 5 * 60_000 }
    wsOrg.set(workspaceId, hit)
  }
  return hit.orgId ? entitlements(hit.orgId) : OPEN
}

/** Atalho para os pontos de envio automático do motor: true = pode enviar. */
export async function automationAllowed(workspaceId: string): Promise<boolean> {
  return (await entitlementsForWorkspace(workspaceId)).podeAutomatizar
}
