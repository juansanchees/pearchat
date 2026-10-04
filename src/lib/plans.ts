// Fonte única dos planos: nome, limites e preço. Sem imports de servidor (a tela também pode ler os nomes e limites).
// Preço: padrão = valores já exibidos no drawer "Plano e pagamento"; o dono pode sobrescrever por PLAN_PRICE_ESSENCIAL,
// PLAN_PRICE_PRO e PLAN_PRICE_NEGOCIOS (em reais, ex.: 149 ou 149.90) — só no servidor.
export type PlanKey = 'ESSENCIAL' | 'PRO' | 'NEGOCIOS'
export const PLAN_KEYS: PlanKey[] = ['ESSENCIAL', 'PRO', 'NEGOCIOS']

export type PlanDef = {
  nome: 'Essencial' | 'Pro' | 'Negócios'
  /** WhatsApps (espaços não arquivados). */
  espacos: number
  /** Pessoas na equipe (ativas + convites pendentes). */
  pessoas: number
  /** Por mês; null = ilimitado. */
  respostasIa: number | null
  disparos: number | null
  contatos: number | null
  precoPadrao: number
}

export const PLANS: Record<PlanKey, PlanDef> = {
  ESSENCIAL: { nome: 'Essencial', espacos: 1, pessoas: 1, respostasIa: 500, disparos: 1000, contatos: 1000, precoPadrao: 79 },
  PRO: { nome: 'Pro', espacos: 3, pessoas: 5, respostasIa: 3000, disparos: 10000, contatos: 5000, precoPadrao: 149 },
  NEGOCIOS: { nome: 'Negócios', espacos: 5, pessoas: 15, respostasIa: null, disparos: null, contatos: null, precoPadrao: 299 },
}

export const PLAN_RANK: Record<PlanKey, number> = { ESSENCIAL: 0, PRO: 1, NEGOCIOS: 2 }

/** Preço mensal em reais. Valor inválido no ambiente cai no padrão. Nunca vem do navegador. */
export function planPrice(key: PlanKey): number {
  const raw = typeof process !== 'undefined' ? process.env[`PLAN_PRICE_${key}`] : undefined
  const n = raw ? Number(raw.replace(',', '.')) : NaN
  return Number.isFinite(n) && n >= 5 && n <= 100000 ? Math.round(n * 100) / 100 : PLANS[key].precoPadrao
}

export function planFromName(nome: unknown): PlanKey | null {
  return PLAN_KEYS.find((k) => PLANS[k].nome === nome || k === nome) ?? null
}
