import type { AgentTom } from '@/lib/types'
import type { KbPair } from './prompt'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type GenerateReplyResult = { texto: string; simulado: boolean }

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

const TIMEOUT_MS = 45_000
const MAX_TOKENS = 600
const OPENAI_MAX_COMPLETION_TOKENS = 1500

function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => {
    // fetch falhou (rede/timeout): mensagem curta, sem URL nem cabeçalhos.
    throw new LlmError(e instanceof Error && e.name === 'TimeoutError' ? 'Provedor de IA demorou demais' : 'Provedor de IA indisponível')
  })
  // Nunca logar chaves nem o conteúdo da conversa: só o status.
  if (!res.ok) throw new LlmError(`Provedor de IA respondeu ${res.status}`, res.status)
  return res.json()
}

async function callAnthropic(key: string, system: string, messages: ChatMessage[]): Promise<string> {
  const json = (await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001', max_tokens: MAX_TOKENS, system, messages },
  )) as { content?: { type?: string; text?: unknown }[] }
  const bloco = json.content?.find((c) => c.type === 'text')
  const texto = textOf(bloco?.text)
  if (!texto) throw new LlmError('Resposta vazia do provedor de IA')
  return texto
}

async function callOpenAi(key: string, system: string, messages: ChatMessage[]): Promise<string> {
  const json = (await postJson(
    'https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${key}` },
    {
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      // Modelos novos da OpenAI rejeitam max_tokens e temperature: só max_completion_tokens.
      // Modelos de raciocínio gastam parte do limite pensando: folga extra para sobrar texto visível.
      max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS,
      messages: [{ role: 'system', content: system }, ...messages],
    },
  )) as { choices?: { message?: { content?: unknown } }[] }
  const texto = textOf(json.choices?.[0]?.message?.content)
  if (!texto) throw new LlmError('Resposta vazia do provedor de IA')
  return texto
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
}

/**
 * Gera uma resposta do agente. Usa a Anthropic quando ANTHROPIC_API_KEY existe, senão a OpenAI
 * (OPENAI_API_KEY). Sem nenhuma chave devolve a resposta simulada (`simulate`, ou um texto genérico)
 * com `simulado: true`. Lança LlmError se o provedor falhar.
 */
export async function generateReply({
  system,
  messages,
  simulate,
}: {
  system: string
  messages: ChatMessage[]
  simulate?: () => string
}): Promise<GenerateReplyResult> {
  const anthropic = process.env.ANTHROPIC_API_KEY
  if (anthropic) return { texto: await callAnthropic(anthropic, system, messages), simulado: false }
  const openai = process.env.OPENAI_API_KEY
  if (openai) return { texto: await callOpenAi(openai, system, messages), simulado: false }
  return { texto: simulate ? simulate() : 'Posso te ajudar com encomendas, preços, entregas e pagamento. O que você precisa?', simulado: true }
}

// ---- Simulador (protótipo, spec 04 "Testar o agente") ----

const PREFIXO: Record<AgentTom, string> = { Amigável: 'Oi! ', Profissional: 'Olá, tudo bem? ', Direto: '' }

export const HANDOFF_DESCONTO = 'Pedido de desconto'
export const HANDOFF_ATENDENTE = 'Cliente pede um atendente'

/** Detecta as regras de passagem como o protótipo (só desconto e atendente). */
export function detectHandoff(mensagem: string, handoffRules: string[], responsavel: string): string | null {
  const q = mensagem.toLowerCase().trim()
  if (/desconto|mais barato|promo/.test(q) && handoffRules.includes(HANDOFF_DESCONTO)) {
    return `Vou chamar ${responsavel} para falar sobre condições especiais com você. Ela responde em instantes.`
  }
  if (/atendente|humano|pessoa/.test(q) && handoffRules.includes(HANDOFF_ATENDENTE)) {
    return `Claro, já estou passando sua conversa para ${responsavel}.`
  }
  return null
}

/** Resposta simulada do protótipo (usada sem chave de IA). A passagem é tratada antes, em detectHandoff. */
export function simulateReply(mensagem: string, tom: AgentTom, kb: KbPair[]): string {
  const q = mensagem.toLowerCase().trim()
  const pre = PREFIXO[tom]
  const kbHit = kb.find((k) => k.pergunta.toLowerCase().split(/\W+/).some((w) => w.length > 4 && q.includes(w)))
  if (/pre[cç]o|valor|quanto/.test(q)) return pre + 'O bolo de 1 kg sai a partir de R$ 98 e o de 2 kg a partir de R$ 189. Qual sabor você prefere?'
  if (/entrega|entregam|frete/.test(q)) return pre + 'Entregamos em toda a zona leste com taxa de R$ 12 até 8 km. Qual o seu bairro?'
  if (/pix|cart[aã]o|pagamento|pagar/.test(q)) return pre + 'Aceitamos Pix, crédito e débito. Para encomendas pedimos sinal de 50%.'
  if (kbHit) return pre + kbHit.resposta
  return pre + 'Posso te ajudar com encomendas, preços, entregas e pagamento. O que você precisa?'
}
