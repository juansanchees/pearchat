import type { Plan } from '@prisma/client'

/** Pessoas na equipe por plano (usuários ativos + convites pendentes). */
export const PLAN_MEMBER_LIMIT: Record<Plan, number> = { ESSENCIAL: 1, PRO: 5, NEGOCIOS: 15 }
