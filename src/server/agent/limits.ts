// Tetos de "Testar o agente" (cada teste pode custar chamadas de IA que o PearChat paga). Não entram na cota do plano:
// têm teto próprio por usuário (por hora) e por organização (por dia).
export const AGENT_TEST_PER_USER_HOUR = 20
export const AGENT_TEST_PER_ORG_DAY = 100
/** O corpo legítimo (mensagem de até 1000 caracteres + instruções de até 4000 + regras) cabe folgado em 32 KB. */
export const AGENT_TEST_BODY_LIMIT = 32 * 1024
