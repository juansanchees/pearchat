import type { Plan } from '@prisma/client'
import { PLANS } from '@/lib/plans'

/** Pessoas na equipe por plano (usuários ativos + convites pendentes). Fonte: src/lib/plans.ts. */
export const PLAN_MEMBER_LIMIT: Record<Plan, number> = { ESSENCIAL: PLANS.ESSENCIAL.pessoas, PRO: PLANS.PRO.pessoas, NEGOCIOS: PLANS.NEGOCIOS.pessoas }
