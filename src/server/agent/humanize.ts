import type { AgentTom } from '@/lib/types'

// Acabamento determinístico da resposta do modelo, antes do envio (e no "Testar o agente").
// Conservador por construção: só tira forma (markdown, listas, espaços, emoji a mais) e frases INTEIRAS de fórmula ou de
// reapresentação. Nunca altera o conteúdo de uma frase que fica: valores, horários, links e e-mails passam intactos.

export type HumanizeOpts = {
  tom?: AgentTom
  /** Já existe resposta da IA nesta conversa (saudação e apresentação não cabem mais). */
  jaRespondeu?: boolean
  /** Nome do agente, para reconhecer a reapresentação ("Eu sou o Luiz do suporte"). */
  agentName?: string
  /** O que o cliente acabou de escrever. */
  clienteTexto?: string
}

const KEEP_SYMBOLS = new Set(['©', '®', '™'])
// Construtor (e não literal): o tsconfig mira ES5 e recusa a flag "u" em literal; o Node aceita.
const EMOJI_RE = new RegExp(
  '(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\u20E3|[\\u{1F3FB}-\\u{1F3FF}]|\\u200D(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})\\uFE0F?)*',
  'gu',
)
const LOWER_START = new RegExp('^([\\s¡¿"\'(]*)(\\p{Ll})', 'u')

/** Minúsculo, sem acento, sem emoji nem pontuação: para comparar frases com as listas abaixo. */
export function normSentence(s: string): string {
  return s
    .replace(EMOJI_RE, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Frases inteiras de roteiro (pt, es, en). Só saem quando sobra outra frase com conteúdo. */
const FORMULAS: RegExp[] = [
  // pt
  /^(?:eu )?(?:entendo|compreendo)(?: (?:a |sua |a sua |seu |o seu )?(?:solicitacao|situacao|preocupacao|duvida|frustracao|pedido|lado))?$/,
  /^(?:entendi|entendido)$/,
  /^(?:fico|estou|estamos|ficamos|sigo|seguimos) (?:a |a sua |a tua )?(?:inteira )?disposicao(?: para (?:o que|qualquer|quaisquer) .{0,40})?$/,
  /^qualquer (?:outra )?(?:duvida|coisa)(?: e so (?:chamar|falar|me chamar|mandar mensagem)| estou a disposicao| estamos a disposicao| fico a disposicao| me chama| me avisa)$/,
  /^(?:como|em que) (?:mais )?(?:posso|podemos) (?:te |lhe )?ajudar(?: voce)?(?: hoje| agora)?$/,
  /^(?:posso|podemos) (?:te |lhe )?ajudar (?:em|com) (?:algo|mais alguma coisa|alguma outra coisa)(?: mais)?$/,
  /^mais alguma (?:coisa|duvida)(?: (?:em que|que) (?:eu )?(?:possa|posso) (?:te )?ajudar)?$/,
  /^(?:agradeco|agradecemos|obrigad[oa]) (?:pelo|o) (?:seu )?contato$/,
  /^(?:lamentamos|lamento) (?:muito )?(?:o|pelo) (?:ocorrido|transtorno|inconveniente)$/,
  /^(?:pedimos|peco) desculpas? (?:pelo|pelos|por qualquer) (?:transtorno|transtornos|inconveniente|inconvenientes)(?: causados?)?$/,
  /^desculpe? (?:o|pelo) transtorno$/,
  /^espero ter (?:ajudado|esclarecido)$/,
  // es
  /^(?:entiendo|comprendo)(?: (?:tu|su) (?:solicitud|situacion|preocupacion|frustracion|consulta))?$/,
  /^(?:quedo|quedamos|estoy|estamos) a (?:tu|su) (?:entera )?disposicion(?: para .{0,40})?$/,
  /^(?:en que|como) (?:mas )?(?:puedo|podemos|te puedo|le puedo) (?:ayudarte|ayudarle|ayudar)(?: hoy)?$/,
  /^(?:hay )?algo mas (?:en (?:lo )?que|con lo que|que) (?:te |le )?(?:pueda|podamos) (?:ayudar|ayudarte|ayudarle)$/,
  /^(?:gracias|muchas gracias) por (?:contactarnos|escribirnos|comunicarte|comunicarse)$/,
  /^(?:lamento|lamentamos|disculpa|disculpe|perdon por) (?:mucho )?(?:el|las|los|la) (?:inconveniente|inconvenientes|molestias|molestia)(?: causad[oa]s?)?$/,
  /^espero (?:haberte|haberle) (?:ayudado|sido de ayuda)$/,
  /^cualquier (?:otra )?(?:duda|cosa|consulta)(?: aqui estoy| me escribes| me avisas| quedo atent[oa]| estoy a tu disposicion)$/,
  // en
  /^i (?:completely |totally )?understand(?: your (?:concern|frustration|request|situation))?$/,
  /^(?:i |we )?(?:sincerely )?(?:apologize|am sorry|are sorry|im sorry|were sorry) for (?:any|the) inconvenience(?: (?:this|that) (?:may have )?caused)?$/,
  /^sorry for (?:any|the) inconvenience$/,
  /^(?:is there )?anything else (?:i|we) can (?:help|assist) (?:you )?with(?: today)?$/,
  /^how (?:can|may) (?:i|we) (?:help|assist) you(?: today)?$/,
  /^(?:thank you|thanks) for (?:reaching out|contacting us|getting in touch)$/,
  /^(?:feel free to|dont hesitate to) (?:reach out|contact us|ask)(?: .{0,40})?$/,
  /^let me know if you (?:need|have) anything else$/,
  /^(?:i )?hope (?:this|that) helps$/,
]

/** Interjeição solta no começo ("Perfeito!", "¡Claro!", "Got it."): sai no tom Direto e no Profissional. */
const OPENERS = /^(?:claro|certo|perfeito|otimo|beleza|combinado|show|perfecto|genial|claro que si|por supuesto|vale|listo|sure|great|perfect|of course|got it|okay|ok|alright)$/

const GREETING = /^(?:oi|ola|hola|hi|hello|hey|opa|e ai|eai|buenas|bom dia|boa tarde|boa noite|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|good evening)(?: (?:tudo bem|tudo bom|como vai|como estas|como esta|que tal|how are you))?$/
const GREETING_START = /^\s*[¡!]?\s*(?:oi|ol[aá]|hola|hi|hello|hey|opa|buenas|bom dia|boa tarde|boa noite|buenos d[ií]as|buenas tardes|buenas noches|good (?:morning|afternoon|evening))\b/i

/** O cliente perguntou quem é / se é robô: aí a apresentação é a resposta e fica. */
const ASKS_IDENTITY = /\b(?:robo|robot|bot|ia|ai|humano|humana|human|pessoa|persona|person|maquina|machine|quem (?:e|eh|fala)|seu nome|su nombre|tu nombre|quien eres|quien habla|who are you|your name|are you real|inteligencia artificial|artificial)\b/

function capitalize(s: string): string {
  return s.replace(LOWER_START, (_m, pre: string, c: string) => pre + c.toUpperCase())
}

/** Tira negrito, itálico, títulos, crases e asteriscos soltos. */
function stripMarkdown(t: string): string {
  return t
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/`+/g, '')
    .replace(/\*/g, '')
}

const URL_END = /(?:https?:\/\/|www\.)\S+$/i

/** Itens de lista (hífen, marcador ou número) viram frases corridas. */
function flattenLists(t: string): string {
  return t
    .split('\n')
    .map((line) => {
      const m = /^\s*(?:[-•·▪◦–—]|\d{1,2}[.)])\s+(.+)$/.exec(line)
      if (!m) return line
      let item = (m[1] ?? '').trim()
      if (!/[.!?…:;,]$/.test(item) && !URL_END.test(item)) item += '.'
      return capitalize(item)
    })
    .join('\n')
}

/** Travessão como pontuação vira vírgula (intervalos como "9h – 18h" ficam). */
function replaceDashes(t: string): string {
  return t.replace(/\s+[—–]\s+/g, (m, offset: number, s: string) => {
    const before = s.charAt(offset - 1)
    const after = s.charAt(offset + m.length)
    return /\d/.test(before) && /\d/.test(after) ? m : ', '
  })
}

/** Mantém no máximo `max` emojis (os primeiros). */
function limitEmoji(t: string, max: number): string {
  let n = 0
  return t.replace(EMOJI_RE, (e) => {
    if (KEEP_SYMBOLS.has(e)) return e
    n++
    return n <= max ? e : ''
  })
}

// Emoji seguido de frase nova ("...ZapRadar 😊 Me diga...") também separa frases.
const EMOJI_BREAK = new RegExp(`(${EMOJI_RE.source})\\s+(?=[\\p{Lu}¿¡])`, 'gu')

function splitSentences(t: string): string[] {
  return t
    .replace(EMOJI_BREAK, '$1\u0000')
    .split(/(?<=[.!?…])\s+|\u0000/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Frase com link, e-mail ou número tem conteúdo: nunca é cortada como reapresentação. */
const HAS_FACT = /https?:|www\.|@|\d/

/** Frase só de emoji/pontuação ou só saudação não conta como conteúdo. */
function isSubstantive(s: string): boolean {
  const n = normSentence(s)
  return n.length > 0 && !GREETING.test(n)
}

/** "Eu sou o Luiz do Suporte ZapRadar" / "Soy Luiz, del soporte" / "I'm Luiz from support": a frase inteira, curta e sem fatos. */
function isReintroduction(s: string, agentName: string): boolean {
  const name = normSentence(agentName).split(' ')[0]
  if (!name || HAS_FACT.test(s)) return false
  const n = normSentence(s)
  const re = new RegExp(
    `^(?:(?:oi|ola|hola|hi|hello|hey) )?(?:eu )?(?:sou|me chamo|aqui e|quem fala e|soy|me llamo|te habla|le habla|habla|im|i am|my name is|this is) (?:o |a |el |la )?${name}(?: [a-z]+){0,6}$`,
  )
  return re.test(n)
}

/** Acabamento da resposta do modelo (ver o topo do arquivo). Devolve sempre um texto não vazio se a entrada não for vazia. */
export function humanizeReply(text: string, opts: HumanizeOpts = {}): string {
  const tom = opts.tom ?? 'Amigável'
  const base = replaceDashes(flattenLists(stripMarkdown(text)))
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim()
  if (!base) return text.trim()

  let sentences = splitSentences(base)
  const cliente = normSentence(opts.clienteTexto ?? '')
  const clienteCumprimentou = GREETING_START.test(opts.clienteTexto ?? '')

  const drop = (pred: (s: string, i: number) => boolean) => {
    const kept = sentences.filter((s, i) => !pred(s, i))
    // Só corta se sobrar alguma frase com conteúdo (nunca deixa a resposta só com "Oi!" ou vazia).
    if (kept.some(isSubstantive)) sentences = kept
  }

  // Reapresentação depois da primeira resposta (a não ser que o cliente tenha perguntado quem é / se é robô).
  if (opts.jaRespondeu && opts.agentName && !ASKS_IDENTITY.test(cliente)) drop((s) => isReintroduction(s, opts.agentName as string))
  // Saudação de novo no meio da conversa (se o cliente não cumprimentou agora).
  if (opts.jaRespondeu && !clienteCumprimentou) drop((s, i) => i === 0 && GREETING.test(normSentence(s)))
  // Frases inteiras de roteiro.
  drop((s) => !HAS_FACT.test(s) && FORMULAS.some((re) => re.test(normSentence(s))))
  // Interjeição solta de abertura nos tons Direto e Profissional.
  if (tom !== 'Amigável') drop((s, i) => i === 0 && OPENERS.test(normSentence(s)))

  const firstChanged = sentences[0] !== splitSentences(base)[0]
  let out = sentences.join(' ')
  out = limitEmoji(out, tom === 'Amigável' ? 1 : 0)
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?…])/g, '$1').trim()
  if (firstChanged) out = capitalize(out)
  return out || base
}
