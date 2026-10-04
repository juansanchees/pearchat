import type { AgentTom } from '@/lib/types'
import { markVisionUnavailable } from '@/server/media/ai-caps'
import type { KbPair } from './prompt'

/** Imagem anexada a uma mensagem do cliente (entrada de visão). Só a última mensagem do cliente leva imagem. */
export type ChatImage = { mime: string; base64: string }
export type ChatMessage = { role: 'user' | 'assistant'; content: string; image?: ChatImage }

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

const DEFAULT_TIMEOUT_MS = 45_000
const MAX_TOKENS = 600
const OPENAI_MAX_COMPLETION_TOKENS = 1500

// Valores lidos a cada chamada (permitem apontar para um servidor falso em testes e ajustar sem redeploy).
const timeoutMs = () => {
  const n = Number(process.env.LLM_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 200 ? n : DEFAULT_TIMEOUT_MS
}
const openAiBase = () => (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
const anthropicBase = () => (process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com/v1').replace(/\/+$/, '')

function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Resposta cortada pelo limite de tokens: aproveita só as frases completas. Sem nenhuma frase completa
 * devolve null (quem chama trata como erro e tenta de novo, em vez de mandar meia frase ao cliente).
 */
export function trimToLastSentence(text: string): string | null {
  let end = -1
  for (let k = 0; k < text.length; k++) if ('.!?…'.includes(text.charAt(k))) end = k
  const out = end >= 0 ? text.slice(0, end + 1).trim() : null
  return out && out.length >= 20 ? out : null
}

/** Rede de segurança de formato para WhatsApp: tira markdown que o modelo ainda deixar passar. */
export function cleanReply(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/`+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
  }).catch((e: unknown) => {
    // fetch falhou (rede/timeout): mensagem curta, sem URL nem cabeçalhos.
    throw new LlmError(e instanceof Error && e.name === 'TimeoutError' ? 'Provedor de IA demorou demais' : 'Provedor de IA indisponível')
  })
  // Nunca logar chaves nem o conteúdo da conversa: só o status.
  if (!res.ok) throw new LlmError(`Provedor de IA respondeu ${res.status}`, res.status)
  // O corpo também está sujeito ao tempo limite (AbortSignal.timeout cobre a leitura); JSON inválido vira erro curto.
  return res.json().catch((e: unknown) => {
    throw new LlmError(e instanceof Error && e.name === 'TimeoutError' ? 'Provedor de IA demorou demais' : 'Resposta inválida do provedor de IA')
  })
}

const stripImages = (messages: ChatMessage[]): ChatMessage[] => messages.map(({ image: _image, ...m }) => m)

async function callAnthropic(key: string, system: string, chat: ChatMessage[]): Promise<string> {
  const messages = chat.map((m) =>
    m.image
      ? {
          role: m.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.base64 } },
            { type: 'text', text: m.content },
          ],
        }
      : { role: m.role, content: m.content },
  )
  const json = (await postJson(
    `${anthropicBase()}/messages`,
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001', max_tokens: MAX_TOKENS, system, messages },
  )) as { content?: { type?: string; text?: unknown }[]; stop_reason?: string }
  const bloco = json.content?.find((c) => c.type === 'text')
  let texto = textOf(bloco?.text)
  if (texto && json.stop_reason === 'max_tokens') texto = trimToLastSentence(texto)
  if (!texto) throw new LlmError('Resposta vazia do provedor de IA')
  return texto
}

async function callOpenAi(key: string, system: string, chat: ChatMessage[]): Promise<string> {
  const messages = chat.map((m) =>
    m.image
      ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } },
          ],
        }
      : { role: m.role, content: m.content },
  )
  const effort = process.env.AI_REASONING_EFFORT?.trim()
  const json = (await postJson(
    `${openAiBase()}/chat/completions`,
    { authorization: `Bearer ${key}` },
    {
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      // Modelos novos da OpenAI rejeitam max_tokens e temperature: só max_completion_tokens.
      // Modelos de raciocínio gastam parte do limite pensando: folga extra para sobrar texto visível.
      max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS,
      // Opcional (ex.: "low" ou "none" em modelos de raciocínio): só enviado quando configurado, pois modelos antigos o rejeitam.
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [{ role: 'system', content: system }, ...messages],
    },
  )) as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] }
  const choice = json.choices?.[0]
  let texto = textOf(choice?.message?.content)
  // Cortada por limite de tokens: não manda meia frase ao cliente.
  if (texto && choice?.finish_reason === 'length') texto = trimToLastSentence(texto)
  if (!texto) throw new LlmError('Resposta vazia do provedor de IA')
  return texto
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
}

/**
 * Gera uma resposta do agente. Usa a Anthropic quando ANTHROPIC_API_KEY existe, senão a OpenAI
 * (OPENAI_API_KEY). Sem nenhuma chave devolve a resposta simulada (`simulate`, ou um texto genérico)
 * com `simulado: true`. Lança LlmError se o provedor falhar ou devolver resposta vazia/cortada.
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
  const openai = process.env.OPENAI_API_KEY
  if (anthropic || openai) {
    const call = (msgs: ChatMessage[]) => (anthropic ? callAnthropic(anthropic, system, msgs) : callOpenAi(openai as string, system, msgs))
    try {
      return { texto: cleanReply(await call(messages)), simulado: false }
    } catch (e) {
      // O modelo recusou a imagem (não aceita visão, formato, tamanho): lembra por 1 h e responde só com o texto.
      const withImage = messages.some((m) => m.image)
      if (withImage && e instanceof LlmError && e.status !== null && [400, 403, 404, 422].includes(e.status)) {
        markVisionUnavailable()
        return { texto: cleanReply(await call(stripImages(messages))), simulado: false }
      }
      throw e
    }
  }
  return { texto: simulate ? simulate() : 'Posso ajudar com informações sobre nossos produtos e serviços, preços, horários e agendamentos. Sobre o que você quer saber?', simulado: true }
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
  if (/pre[cç]o|valor|quanto/.test(q)) return pre + 'Os valores variam conforme o produto ou serviço. Me conta o que você procura que eu te ajudo com os detalhes.'
  if (/entrega|entregam|frete/.test(q)) return pre + 'Sobre entrega e prazos, me conta o que você precisa que eu te ajudo com os detalhes.'
  if (/pix|cart[aã]o|pagamento|pagar/.test(q)) return pre + 'Sobre formas de pagamento, me conta o que você precisa que eu te ajudo com os detalhes.'
  if (kbHit) return pre + kbHit.resposta
  return pre + 'Posso ajudar com informações sobre nossos produtos e serviços, preços, horários e agendamentos. Sobre o que você quer saber?'
}
