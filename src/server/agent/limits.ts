// Tetos de "Testar o agente" (cada teste pode custar chamadas de IA que o PearChat paga). Não entram na cota do plano:
// têm teto próprio por usuário (por hora) e por organização (por dia), o que também limita um robô com várias contas
// dentro da mesma organização. Contas novas ainda precisam de e-mail confirmado (guard.ts) quando há serviço de e-mail.
import { DAY, HOUR, hitCaps, type CapResult } from '@/server/security/rate-limit'

export const AGENT_TEST_PER_USER_HOUR = 20
export const AGENT_TEST_PER_ORG_DAY = 100
/** O corpo legítimo (mensagem de até 1000 caracteres + instruções de até 4000 + regras) cabe folgado em 32 KB. */
export const AGENT_TEST_BODY_LIMIT = 32 * 1024

/** Conta um teste do agente nos dois tetos (usuário/hora e organização/dia). `orgKey` = organização (ou o espaço, se não houver). */
export function hitAgentTestCaps(
  userId: string,
  orgKey: string,
  limits: { perUserHour: number; perOrgDay: number } = { perUserHour: AGENT_TEST_PER_USER_HOUR, perOrgDay: AGENT_TEST_PER_ORG_DAY },
  now?: number,
): Promise<CapResult> {
  return hitCaps(
    [
      { name: 'agent-test-user-hour', key: userId, max: limits.perUserHour, windowMs: HOUR },
      { name: 'agent-test-org-day', key: orgKey, max: limits.perOrgDay, windowMs: DAY },
    ],
    now,
  )
}
