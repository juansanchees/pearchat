// Textos gravados em AiJob.error quando a IA NÃO responde e passa a conversa para uma pessoa.
// Quem grava (ai-reply.ts) e quem lê (painel de resultados, results/service.ts) usam estas constantes:
// mudar o texto aqui muda os dois lados juntos.

/** Prefixo da passagem por regra de palavra-chave; o motivo vem depois ("passagem: <regra>"). */
export const HANDOFF_RULE_PREFIX = 'passagem: '
/** Passagem decidida pelo modelo (marcador de passagem na resposta). */
export const HANDOFF_MODEL_NOTE = 'passagem pelo modelo'
/** Limite mensal de respostas de IA do plano atingido. */
export const HANDOFF_LIMIT_NOTE = 'limite de respostas de IA do plano'

/** Observação de passagem por regra. */
export const handoffRuleNote = (motivo: string): string => `${HANDOFF_RULE_PREFIX}${motivo}`

/** Padrões LIKE (SQL) para o painel: qualquer passagem, e só as por regra. */
export const HANDOFF_LIKE_ANY = ['passagem%', 'limite de respostas%'] as const
export const HANDOFF_LIKE_RULE = `${HANDOFF_RULE_PREFIX}%`
export const HANDOFF_LIKE_LIMIT = 'limite de respostas%'
/** Posição (1-based, para substr do SQL) onde começa o motivo depois do prefixo. */
export const HANDOFF_RULE_PREFIX_END = HANDOFF_RULE_PREFIX.length + 1
