import type { AgentTom } from '@/lib/types'
import { markVisionUnavailable } from '@/server/media/ai-caps'
import type { KbPair } from './prompt'

/** Imagem anexada a uma mensagem do cliente (entrada de visão). Só a última mensagem do cliente leva imagem. */
export type ChatImage = { mime: string; base64: string }
export type ChatMessage = { role: 'user' | 'assistant'; content: string; image?: ChatImage }

export type GenerateReplyResult = { texto: string; simulado: boolean; rodadasFerramenta?: number }

/** Ferramentas oferecidas ao modelo (function calling). `run` nunca deve lançar: erro vira resultado { ok:false }. */
export type ToolBridge = {
  defs: { name: string; description: string; parameters: Record<string, unknown> }[]
  run: (name: string, args: unknown) => Promise<unknown>
}

/** No máximo 4 rodadas de ferramenta por resposta; depois disso o modelo é obrigado a responder em texto. */
export const MAX_TOOL_ROUNDS = 4
const MAX_CALLS_PER_ROUND = 4
const TOOL_RESULT_MAX_CHARS = 4000
/** Resposta segura quando o laço de ferramentas não termina (modelo que nunca para, tempo esgotado). */
export const TOOL_SAFE_REPLY = 'Desculpe, não consegui consultar a agenda agora. Pode me dizer de novo o dia e o horário que prefere? Se preferir, a equipe confirma com você.'
const toolsTotalMs = () => {
  const n = Number(process.env.LLM_TOOLS_TOTAL_MS)
  return Number.isFinite(n) && n >= 1000 ? n : 70_000
}
const MIN_CALL_MS = 3_000

// Se o modelo/provedor recusa `tools` (400/404/422 sem imagem), lembra por 1 h e usa o protocolo por saída estruturada.
const g = globalThis as unknown as { __pearchat_tools_off_until?: number }
const toolsOff = () => (g.__pearchat_tools_off_until ?? 0) > Date.now()
const markToolsUnavailable = () => {
  g.__pearchat_tools_off_until = Date.now() + 3_600_000
}
export const resetToolsAvailability = () => {
  g.__pearchat_tools_off_until = 0
}

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

async function postJson(url: string, headers: Record<string, string>, body: unknown, ms: number = timeoutMs()): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
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

async function callAnthropic(key: string, system: string, chat: ChatMessage[], ms?: number): Promise<string> {
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
    ms,
  )) as { content?: { type?: string; text?: unknown }[]; stop_reason?: string }
  const bloco = json.content?.find((c) => c.type === 'text')
  let texto = textOf(bloco?.text)
  if (texto && json.stop_reason === 'max_tokens') texto = trimToLastSentence(texto)
  if (!texto) throw new LlmError('Resposta vazia do provedor de IA')
  return texto
}

async function callOpenAi(key: string, system: string, chat: ChatMessage[], ms?: number): Promise<string> {
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
    ms,
  )) as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] }
  const choice = json.choices?.[0]
  let texto = textOf(choice?.message?.content)
  // Cortada por limite de tokens: não manda meia frase ao cliente.
  if (texto && choice?.finish_reason === 'length') texto = trimToLastSentence(texto)
  if (!texto) throw new LlmError('Resposta vazia do provedor de IA')
  return texto
}

// ---- Ferramentas (function calling) ----

function safeJson(v: unknown): string {
  let t: string
  try {
    t = JSON.stringify(v) ?? 'null'
  } catch {
    t = JSON.stringify({ ok: false, erro: 'Resultado ilegível.' })
  }
  return t.length > TOOL_RESULT_MAX_CHARS ? `${t.slice(0, TOOL_RESULT_MAX_CHARS)}…` : t
}

/** Argumentos que o modelo mandou (texto JSON). JSON quebrado vira erro devolvido ao modelo, nunca exceção. */
function parseArgs(raw: unknown): { ok: true; args: unknown } | { ok: false } {
  if (raw && typeof raw === 'object') return { ok: true, args: raw }
  if (typeof raw !== 'string' || !raw.trim()) return { ok: true, args: {} }
  try {
    return { ok: true, args: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false }
  }
}

const BAD_ARGS = { ok: false, codigo: 'ARGUMENTOS_INVALIDOS', erro: 'Os argumentos não eram um JSON válido. Corrija e chame de novo.' }

/** Executa a ferramenta sem deixar a exceção derrubar o laço (o contrato é nunca lançar; isto é a rede de segurança). */
async function runTool(tools: ToolBridge, name: string, args: unknown): Promise<unknown> {
  try {
    return await tools.run(name, args)
  } catch {
    return { ok: false, codigo: 'ERRO_INTERNO', erro: 'A ferramenta falhou. Diga ao cliente que a equipe confirma o horário.' }
  }
}

type OpenAiToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }

async function openAiToolLoop(key: string, system: string, chat: ChatMessage[], tools: ToolBridge): Promise<{ texto: string; rodadas: number }> {
  const base: unknown[] = chat.map((m) =>
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
  const msgs: unknown[] = [{ role: 'system', content: system }, ...base]
  const effort = process.env.AI_REASONING_EFFORT?.trim()
  const toolDefs = tools.defs.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters } }))
  const deadline = Date.now() + toolsTotalMs()
  let rodadas = 0
  for (let round = 0; ; round++) {
    const useTools = round < MAX_TOOL_ROUNDS
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) return { texto: TOOL_SAFE_REPLY, rodadas }
    const json = (await postJson(
      `${openAiBase()}/chat/completions`,
      { authorization: `Bearer ${key}` },
      {
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        max_completion_tokens: OPENAI_MAX_COMPLETION_TOKENS,
        ...(effort ? { reasoning_effort: effort } : {}),
        messages: msgs,
        ...(useTools ? { tools: toolDefs } : {}),
      },
      Math.min(timeoutMs(), remaining),
    )) as { choices?: { message?: { content?: unknown; tool_calls?: OpenAiToolCall[] }; finish_reason?: string }[] }
    const choice = json.choices?.[0]
    const calls = choice?.message?.tool_calls
    if (!useTools || !calls || calls.length === 0) {
      let texto = textOf(choice?.message?.content)
      if (texto && choice?.finish_reason === 'length') texto = trimToLastSentence(texto)
      if (!texto) {
        if (!useTools) return { texto: TOOL_SAFE_REPLY, rodadas }
        throw new LlmError('Resposta vazia do provedor de IA')
      }
      return { texto, rodadas }
    }
    rodadas++
    msgs.push({ role: 'assistant', content: textOf(choice?.message?.content), tool_calls: calls })
    for (let k = 0; k < calls.length; k++) {
      const c = calls[k]
      const id = c.id ?? `call_${round}_${k}`
      let result: unknown
      if (k >= MAX_CALLS_PER_ROUND) result = { ok: false, erro: 'Muitas chamadas de uma vez. Faça uma por vez.' }
      else {
        const a = parseArgs(c.function?.arguments)
        result = a.ok ? await runTool(tools, String(c.function?.name ?? ''), a.args) : BAD_ARGS
      }
      msgs.push({ role: 'tool', tool_call_id: id, content: safeJson(result) })
    }
  }
}

type AnthropicBlock = { type?: string; text?: unknown; id?: string; name?: string; input?: unknown }

async function anthropicToolLoop(key: string, system: string, chat: ChatMessage[], tools: ToolBridge): Promise<{ texto: string; rodadas: number }> {
  const msgs: unknown[] = chat.map((m) =>
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
  const toolDefs = tools.defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }))
  const deadline = Date.now() + toolsTotalMs()
  let rodadas = 0
  for (let round = 0; ; round++) {
    const useTools = round < MAX_TOOL_ROUNDS
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) return { texto: TOOL_SAFE_REPLY, rodadas }
    const json = (await postJson(
      `${anthropicBase()}/messages`,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001', max_tokens: MAX_TOKENS, system, messages: msgs, ...(useTools ? { tools: toolDefs } : {}) },
      Math.min(timeoutMs(), remaining),
    )) as { content?: AnthropicBlock[]; stop_reason?: string }
    const uses = (json.content ?? []).filter((b) => b.type === 'tool_use')
    if (!useTools || uses.length === 0) {
      let texto = textOf((json.content ?? []).find((b) => b.type === 'text')?.text)
      if (texto && json.stop_reason === 'max_tokens') texto = trimToLastSentence(texto)
      if (!texto) {
        if (!useTools) return { texto: TOOL_SAFE_REPLY, rodadas }
        throw new LlmError('Resposta vazia do provedor de IA')
      }
      return { texto, rodadas }
    }
    rodadas++
    msgs.push({ role: 'assistant', content: json.content })
    const results: unknown[] = []
    for (let k = 0; k < uses.length; k++) {
      const u = uses[k]
      const result = k >= MAX_CALLS_PER_ROUND ? { ok: false, erro: 'Muitas chamadas de uma vez. Faça uma por vez.' } : await runTool(tools, String(u.name ?? ''), u.input ?? {})
      results.push({ type: 'tool_result', tool_use_id: u.id, content: safeJson(result) })
    }
    msgs.push({ role: 'user', content: results })
  }
}

// Protocolo por saída estruturada (modelos/provedores sem `tools`): o modelo escreve uma linha
// <<FERRAMENTA>>{"acao":"...","argumentos":{...}}<<FIM>> e o sistema devolve <<RESULTADO>>{...}<<FIM>>.
const TOOL_OPEN = '<<FERRAMENTA>>'
const RESULT_OPEN = '<<RESULTADO>>'
const TOOL_END = '<<FIM>>'

function structuredSystem(system: string, tools: ToolBridge, allow: boolean): string {
  if (!allow) return `${system}\n\nNão use mais ferramentas: responda agora ao cliente em texto, com o que já sabe.`
  const lista = tools.defs.map((d) => `- ${d.name}: ${d.description} Argumentos: ${JSON.stringify((d.parameters as { properties?: unknown }).properties ?? {})}`).join('\n')
  return [
    system,
    '',
    'FERRAMENTAS (protocolo):',
    `Para consultar ou alterar a agenda, responda SOMENTE com uma linha neste formato exato, sem nenhum outro texto: ${TOOL_OPEN}{"acao":"nome_da_ferramenta","argumentos":{...}}${TOOL_END}`,
    `O sistema então responde com uma mensagem começando em ${RESULT_OPEN}. Use o resultado para decidir o próximo passo ou para responder ao cliente. Quando não precisar de mais nenhuma ferramenta, responda normalmente em texto ao cliente (sem o formato acima).`,
    'Ferramentas disponíveis:',
    lista,
  ].join('\n')
}

async function structuredToolLoop(
  call: (system: string, chat: ChatMessage[], ms: number) => Promise<string>,
  system: string,
  chat: ChatMessage[],
  tools: ToolBridge,
): Promise<{ texto: string; rodadas: number }> {
  const hist: ChatMessage[] = chat.map((m) => ({ ...m }))
  const deadline = Date.now() + toolsTotalMs()
  // Sem <<FIM>> (resposta cortada) também conta como chamada: o JSON quebrado volta ao modelo como erro e o marcador nunca vai ao cliente.
  const re = new RegExp(`${TOOL_OPEN}([\\s\\S]*?)(?:${TOOL_END}|$)`)
  let rodadas = 0
  for (let round = 0; ; round++) {
    const allow = round < MAX_TOOL_ROUNDS
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) return { texto: TOOL_SAFE_REPLY, rodadas }
    const out = await call(structuredSystem(system, tools, allow), hist, Math.min(timeoutMs(), remaining))
    const m = re.exec(out)
    if (!m || !allow) {
      const limpo = out.replace(new RegExp(`${TOOL_OPEN}[\\s\\S]*$`), '').trim()
      return { texto: limpo || (m ? TOOL_SAFE_REPLY : out), rodadas }
    }
    rodadas++
    let result: unknown
    try {
      const parsed = JSON.parse(m[1]) as { acao?: unknown; argumentos?: unknown }
      result = typeof parsed.acao === 'string' ? await runTool(tools, parsed.acao, parsed.argumentos ?? {}) : BAD_ARGS
    } catch {
      result = BAD_ARGS
    }
    hist.push({ role: 'assistant', content: `${TOOL_OPEN}${m[1]}${TOOL_END}` }, { role: 'user', content: `${RESULT_OPEN}${safeJson(result)}${TOOL_END}` })
  }
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
  tools,
}: {
  system: string
  messages: ChatMessage[]
  simulate?: () => string
  /** Ferramentas de agenda (function calling). Sem elas o comportamento é o de sempre. */
  tools?: ToolBridge
}): Promise<GenerateReplyResult> {
  const anthropic = process.env.ANTHROPIC_API_KEY
  const openai = process.env.OPENAI_API_KEY
  if (anthropic || openai) {
    let rodadas = 0
    const plain = (msgs: ChatMessage[]) => (anthropic ? callAnthropic(anthropic, system, msgs) : callOpenAi(openai as string, system, msgs))
    const structured = async (msgs: ChatMessage[]) => {
      const r = await structuredToolLoop(
        (sys, chat, ms) => (anthropic ? callAnthropic(anthropic, sys, chat, ms) : callOpenAi(openai as string, sys, chat, ms)),
        system,
        msgs,
        tools as ToolBridge,
      )
      rodadas = r.rodadas
      return r.texto
    }
    const call = async (msgs: ChatMessage[]): Promise<string> => {
      if (!tools) return plain(msgs)
      if (toolsOff()) return structured(msgs)
      try {
        const r = anthropic ? await anthropicToolLoop(anthropic, system, msgs, tools) : await openAiToolLoop(openai as string, system, msgs, tools)
        rodadas = r.rodadas
        return r.texto
      } catch (e) {
        // O provedor recusou `tools` (sem imagem no meio, que tem tratamento próprio abaixo): usa o protocolo estruturado.
        if (e instanceof LlmError && e.status !== null && [400, 404, 422].includes(e.status) && !msgs.some((m) => m.image)) {
          markToolsUnavailable()
          return structured(msgs)
        }
        throw e
      }
    }
    try {
      return { texto: cleanReply(await call(messages)), simulado: false, rodadasFerramenta: rodadas }
    } catch (e) {
      // O modelo recusou a imagem (não aceita visão, formato, tamanho): lembra por 1 h e responde só com o texto.
      const withImage = messages.some((m) => m.image)
      if (withImage && e instanceof LlmError && e.status !== null && [400, 403, 404, 422].includes(e.status)) {
        markVisionUnavailable()
        return { texto: cleanReply(await call(stripImages(messages))), simulado: false, rodadasFerramenta: rodadas }
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
