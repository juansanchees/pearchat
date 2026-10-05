// Idioma das respostas da IA: configuração, detecção local (sem rede) e textos fixos enviados pelo motor.

export type Idioma = 'pt' | 'en' | 'es'
export type IdiomaConfig = 'auto' | Idioma

export const IDIOMA_CONFIG_VALUES = ['auto', 'pt', 'en', 'es'] as const

/** Nome do idioma como entra no prompt. */
export const IDIOMA_NOME: Record<Idioma, string> = { pt: 'português do Brasil', en: 'inglês', es: 'espanhol' }

/** Valor do banco (texto livre) -> configuração válida. Qualquer coisa desconhecida vira 'auto'. */
export function parseIdiomaConfig(v: string | null | undefined): IdiomaConfig {
  return (IDIOMA_CONFIG_VALUES as readonly string[]).includes(v ?? '') ? (v as IdiomaConfig) : 'auto'
}

// ---- Detecção ----
// Heurística barata: palavras frequentes que NÃO existem (ou quase nunca) nos outros dois idiomas, mais caracteres
// típicos. Comparadas sem acento. Palavras ambíguas (de, para, por, que, como, no, a, o, mas...) ficam de fora.

const PT = new Set(
  'nao voce voces vc vcs estou tenho quero preciso obrigado obrigada ola oi bom boa pra pro meu minha meus minhas quanto custa tem gostaria posso ajuda tambem muito sim bem tudo isso esse essa quando onde qual fazer amanha hoje uma um os ou em dos das seu sua seus suas foi ja ainda agora aqui sao pode podem queria quais fica funciona horarios atendem'.split(' '),
)
const ES = new Set(
  'hola buenos buenas tardes noches gracias necesito quiero tengo estoy ayuda usted ustedes tienen tiene quisiera puedo cuanto cuesta cuando donde cual cuales hacer manana hoy muy si bien mi mis el la los las un una con en y pero tambien esto ese esa eso precio ahora del al sus estan pueden queria tienes puede abren atienden hay'.split(' '),
)
const EN = new Set(
  'the is are i you your my hi hello hey what when where how can could would please thanks thank need want have has order hours open opening price much there this that with about help know tell not am was will just like get from at be if or but and to of in on it for does we our us which who why available any some'.split(' '),
)

function strip(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Idioma do texto (pt, en ou es), ou null quando não dá para saber (emoji, número, "ok", empate). */
export function detectLanguage(text: string): Idioma | null {
  const raw = text.toLowerCase()
  const score = { pt: 0, en: 0, es: 0 }
  // Caracteres típicos (no texto com acento).
  score.es += 3 * ((raw.match(/[¿¡]/g) ?? []).length > 0 ? 1 : 0) + 2 * (raw.match(/ñ/g) ?? []).length
  score.pt += 2 * (raw.match(/[ãõ]/g) ?? []).length + (raw.match(/ç/g) ?? []).length
  for (const w of strip(raw).split(/[^a-z]+/)) {
    if (!w) continue
    if (PT.has(w)) score.pt++
    if (ES.has(w)) score.es++
    if (EN.has(w)) score.en++
  }
  const ranked = (Object.entries(score) as [Idioma, number][]).sort((a, b) => b[1] - a[1])
  const [top, second] = [ranked[0] as [Idioma, number], ranked[1] as [Idioma, number]]
  return top[1] >= 1 && top[1] > second[1] ? top[0] : null
}

/**
 * Idioma detectado na conversa do cliente: o da última mensagem (as mensagens seguidas desde a última resposta da IA,
 * juntas); se for inconclusiva, volta nas anteriores do cliente. null = nada decide.
 */
export function detectReplyLanguage(history: { role: string; content: string }[]): Idioma | null {
  const users: string[] = []
  let batch: string[] = []
  let inLastBatch = true
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i] as { role: string; content: string }
    if (m.role === 'assistant') {
      if (inLastBatch && batch.length > 0) {
        users.push(batch.reverse().join('\n'))
        batch = []
      }
      inLastBatch = false
      continue
    }
    if (inLastBatch) batch.push(m.content)
    else users.push(m.content)
  }
  if (inLastBatch && batch.length > 0) users.push(batch.reverse().join('\n'))
  for (const t of users) {
    const d = detectLanguage(t)
    if (d) return d
  }
  return null
}

/** Idioma da resposta: o configurado (pt/en/es) vale sempre; em 'auto', o detectado na conversa; sem nada, português. */
export function resolveReplyLanguage(config: IdiomaConfig, history: { role: string; content: string }[]): Idioma {
  if (config !== 'auto') return config
  return detectReplyLanguage(history) ?? 'pt'
}

// ---- Textos fixos enviados pelo motor DENTRO de uma conversa conduzida pela IA ----
// (Lembretes, follow-up e disparos são textos que o próprio dono escreve: não passam por aqui.)

export type FixedTexts = {
  /** Cliente pede um atendente (ou o modelo decide passar para uma pessoa). */
  handoff: (resp: string) => string
  handoffDesconto: (resp: string) => string
  handoffReclamacao: (resp: string) => string
  handoffValorAlto: (resp: string) => string
  /** Limite de respostas de IA do plano: avisa uma vez e passa para a equipe. */
  limite: string
  /** Resposta segura quando o modelo citou um valor que não está nas informações do negócio. */
  valorSeguro: string
  /** Quando o responsável não tem nome cadastrado. */
  responsavel: string
}

export const FIXED: Record<Idioma, FixedTexts> = {
  pt: {
    handoff: (r) => `Vou passar sua conversa para ${r}, que te responde por aqui.`,
    handoffDesconto: (r) => `Vou chamar ${r} para falar sobre condições especiais com você. Já já responde por aqui.`,
    handoffReclamacao: (r) => `Sinto muito por isso. Vou passar sua conversa para ${r}, que vai resolver com você o quanto antes.`,
    handoffValorAlto: (r) => `Para um pedido desse valor prefiro chamar ${r} para fechar os detalhes com você. Já já responde por aqui.`,
    limite: 'Vou chamar alguém da nossa equipe para continuar seu atendimento.',
    // Promete ação da equipe: o acabamento (finish.ts) transforma em passagem, então alguém é de fato avisado.
    valorSeguro: 'Esse valor eu não tenho aqui; vou passar pra equipe confirmar com você.',
    responsavel: 'o responsável',
  },
  en: {
    handoff: (r) => `I'm passing your conversation to ${r}, who'll reply here.`,
    handoffDesconto: (r) => `I'm bringing in ${r} to talk with you about special conditions. They'll reply here shortly.`,
    handoffReclamacao: (r) => `I'm sorry about that. I'm passing your conversation to ${r}, who will sort it out with you as soon as possible.`,
    handoffValorAlto: (r) => `For an order of this size I'd rather bring in ${r} to finalize the details with you. They'll reply here shortly.`,
    limite: "I'll get someone from our team to continue helping you.",
    valorSeguro: "I don't have that amount here; I'll pass this to the team to confirm with you.",
    responsavel: 'the person in charge',
  },
  es: {
    handoff: (r) => `Voy a pasar tu conversación a ${r}, que te responde por aquí.`,
    handoffDesconto: (r) => `Voy a avisar a ${r} para hablar contigo sobre condiciones especiales. En breve te responde por aquí.`,
    handoffReclamacao: (r) => `Lamento mucho eso. Voy a pasar tu conversación a ${r}, que lo resolverá contigo lo antes posible.`,
    handoffValorAlto: (r) => `Para un pedido de este valor prefiero avisar a ${r} para cerrar los detalles contigo. En breve te responde por aquí.`,
    limite: 'Voy a llamar a alguien de nuestro equipo para continuar tu atención.',
    valorSeguro: 'Ese valor no lo tengo aquí; le paso tu consulta al equipo para que te lo confirme.',
    responsavel: 'la persona responsable',
  },
}

/** Todas as versões do aviso de limite (para saber se o cliente já foi avisado, em qualquer idioma). */
export const LIMITE_TODOS = Object.values(FIXED).map((f) => f.limite)
