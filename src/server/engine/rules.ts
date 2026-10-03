import { norm, spParts } from './util'

// ---- Regras de passagem para humano ----

export type HandoffHit = { motivo: string; mensagem: (responsavel: string) => string }

/**
 * Normaliza o texto do cliente para a detecção: sem acento, minúsculo e com as abreviações mais comuns
 * de WhatsApp expandidas ("qro" -> "quero", "c" -> "com", "pesoa" -> "pessoa"...).
 */
export function normChat(s: string): string {
  return norm(s)
    .replace(/[’'`´]/g, '')
    .replace(/\b(qro|kero|keru|qero|quero+)\b/g, 'quero')
    .replace(/\b(c|cm|cmg)\b/g, (m) => (m === 'cmg' ? 'comigo' : 'com'))
    .replace(/\b(vc|voce|voces|vcs)\b/g, (m) => (m.endsWith('s') ? 'voces' : 'voce'))
    .replace(/\b(pesoa|pesssoa|pessoa+|pessoal)\b/g, (m) => (m === 'pessoal' ? 'pessoal' : 'pessoa'))
    .replace(/\b(atendete|atedente|atendent|atendentee|atendnte)\b/g, 'atendente')
    .replace(/\bdesconot\w*/g, 'desconto')
    .replace(/\bmto\b/g, 'muito')
    .replace(/\bn\b/g, 'nao')
    .replace(/\b(tb|tbm)\b/g, 'tambem')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A palavra aparece "negada" (não quero desconto, nada de reclamar, sem problema...)? Olha as ~28 letras anteriores. */
function negatedAt(q: string, index: number): boolean {
  const win = q.slice(Math.max(0, index - 28), index)
  // Se houver "mas/porem" entre a negação e a palavra, a negação não vale.
  const m = win.match(/\b(nao|nem|sem|nada de|nada|dispenso|jamais|nunca)\b(?!.*\b(mas|porem|so que)\b)/)
  return !!m
}

/** Hipótese ("se atrasar", "caso dê problema"): não é reclamação de fato. */
function hypotheticalAt(q: string, index: number): boolean {
  return /\b(se|caso|e se)\s+(?:\w+\s+){0,2}$/.test(q.slice(Math.max(0, index - 24), index))
}

function anyMatch(q: string, patterns: RegExp[], opts: { negation?: boolean; hypothetical?: boolean } = {}): boolean {
  for (const re of patterns) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    for (const m of Array.from(q.matchAll(g))) {
      const idx = m.index ?? 0
      if (opts.negation && negatedAt(q, idx)) continue
      if (opts.hypothetical && hypotheticalAt(q, idx)) continue
      return true
    }
  }
  return false
}

const RE_DESCONTO: RegExp[] = [
  /\bdescont\w*/,
  /\bmais barato\b/,
  /\bpromo(?:cao|coes)?\b/,
  /\babatimento\b/,
  /\bbaratinho\b/,
  /\bfaz(?:er)? por menos\b/,
  /\b(?:ta|esta|tao|muito|bem|meio) caro\b/,
  /\b(?:negociar|abaixar|baixar|reduzir|melhorar)\b.{0,12}\b(?:preco|valor)\b/,
  /\b(?:preco|valor) (?:melhor|menor|mais baixo)\b/,
  /\bcupom\b/,
  /\bpreco de amigo\b/,
  /\bfecha por\b/,
]

const RE_RECLAMACAO: RegExp[] = [
  /\breclama\w*/,
  /\binsatisfeit\w*/,
  /\babsurd\w*/,
  /\b(?:pessim|horrivel|horriveis|terrivel|lamentavel|inaceitavel|ruim\b|vergonha)\w*/,
  /\bdecepcionad\w*/,
  /\b(?:chegou|veio|vieram|chegaram) (?:errad|estragad|quebrad|faltando|com defeito|diferente|frio|fria)\w*/,
  /\bestragad\w*/,
  /\bcom defeito\b/,
  /\bnao gostei\b/,
  /\bquero (?:o |meu )?(?:dinheiro|reembolso|estorno|devolucao)\b/,
  /\b(?:pedir|exijo|exigir|solicitar|cade) (?:o |meu |a )?(?:reembolso|estorno|devolucao|dinheiro)\b/,
  /\b(?:processar|procon|reclame aqui|advogado|golpe|golpista|enganad\w*)\b/,
  /\batrasad\w*/,
  /\batrasou\b/,
  /\b(?:ainda )?nao (?:recebi|chegou|chegaram|entregaram|foi entregue)\b/,
  /\bnunca (?:chegou|recebi|entregaram)\b/,
  /\bninguem (?:me )?responde\b/,
  /\bmal atendid\w*/,
  /\bproblema com (?:o|meu|a|minha) (?:pedido|encomenda|compra|entrega|bolo|produto)\b/,
]

const ROLE = '(?:atendente|humano|pessoa|alguem|gerente|supervisor|dono|dona|responsavel|vendedor|vendedora|funcionari[oa]|proprietari[oa]|chefe|equipe)'
const RE_ATENDENTE: RegExp[] = [
  new RegExp(`\\b(?:falar|conversar|papo|atendimento|contato) (?:direto )?(?:com|de) (?:um |uma |o |a |algum |alguma )?${ROLE}\\b`),
  new RegExp(`\\b(?:quero|preciso|prefiro|queria|gostaria|passa|passar|passe|chama|chamar|chame|transfere|transferir|transfira|cade|coloca|colocar)\\b.{0,14}\\b(?:atendente|humano|pessoa de verdade|pessoa real|gerente|supervisor|dono|dona|responsavel)\\b`),
  /\b(?:atendente|atendimento) (?:humano|de verdade|real)\b/,
  /\b(?:pessoa de verdade|pessoa real|ser humano|gente de verdade)\b/,
  /\btransfer\w*\b.{0,24}\b(?:alguem|equipe|pessoa|atendente|setor|time)\b/,
  /\b(?:chama|chamar|chame) (?:alguem|a mariana|o dono|a dona)\b/,
  /\b(?:quero|preciso|queria|gostaria de|posso) falar com (?!voce|a loja|a empresa|o pessoal|o seu|a sua|voces)\w+/,
  /\bnao (?:quero|vou) falar com (?:robo|bot|maquina)\b/,
]

// ---- Pedido para parar de receber mensagens (opt-out) ----

const RE_STOP_EXATO = /^(?:parar|pare|sair|stop|cancelar|descadastrar|descadastre|remover|chega|nao quero mais|nao quero receber)(?:[, ]+(?:por favor|pfv|obrigad[oa]))?\s*[.!]*$/
const RE_STOP_FRASE: RegExp[] = [
  /\b(?:pare|parar|para) de (?:me |nos )?(?:mandar|enviar|escrever|chamar|incomodar|receber)\b/,
  /\bnao quero (?:mais )?receber\b/,
  /\bdescadastr\w*/,
  /\b(?:sair|me tir(?:ar|a|e)|me remov(?:er|a|e)|me retir(?:ar|a|e)|remover meu numero|tirar meu numero) d[aeo]s? (?:essa |sua |desta |dessa )?(?:lista|grupo|transmissao)\b/,
  /\bremov\w+ (?:o )?meu (?:numero|contato)\b/,
]

/** O cliente pediu para parar de receber mensagens? ("parar", "sair", "pare", "não quero mais receber"...) */
export function isStopRequest(text: string): boolean {
  return text.split('\n').some((line) => {
    const q = normChat(line)
    return RE_STOP_EXATO.test(q) || RE_STOP_FRASE.some((re) => re.test(q))
  })
}

/** Maior valor em reais citado no texto ("R$ 600", "R$1.250,50", "800 reais", "5 mil reais"), ou null. */
export function maxMoney(text: string): number | null {
  const q = text.toLowerCase()
  const values: number[] = []
  const parse = (raw: string): number | null => {
    let s = raw.trim().replace(/[.,]$/, '')
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.') // 1.250,50
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '') // 5.000 (milhar)
    // senão: "50.00" / "5.50" / "1.5": ponto como decimal
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  const NUM = '(\\d[\\d.]*(?:,\\d{1,2})?)'
  for (const m of Array.from(q.matchAll(new RegExp(`r\\$\\s*${NUM}\\s*(mil\\b|k\\b)?`, 'g')))) {
    const v = parse(m[1] ?? '')
    if (v !== null) values.push(m[2] ? v * 1000 : v)
  }
  for (const m of Array.from(q.matchAll(new RegExp(`${NUM}\\s*(mil\\s+|k\\s+)?(?:reais|real|pilas?|contos?)\\b`, 'g')))) {
    const v = parse(m[1] ?? '')
    if (v !== null) values.push(m[2] ? v * 1000 : v)
  }
  return values.length ? Math.max(...values) : null
}

/**
 * Valores "R$ N" da resposta que NÃO aparecem em lugar nenhum do contexto (instruções, base, histórico).
 * Rede de segurança contra preço inventado pelo modelo.
 */
export function ungroundedMoney(reply: string, corpus: string): number[] {
  const parse = (raw: string): number | null => {
    let s = raw.trim().replace(/[.,]+$/, '')
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  const known = new Set<number>()
  for (const m of Array.from(corpus.matchAll(/\d[\d.,]*/g))) {
    const v = parse(m[0])
    if (v !== null) known.add(v)
  }
  const bad: number[] = []
  for (const m of Array.from(reply.toLowerCase().matchAll(/r\$\s*(\d[\d.,]*)/g))) {
    const v = parse(m[1] ?? '')
    if (v !== null && !known.has(v)) bad.push(v)
  }
  return bad
}

/** Limite (R$) lido do nome da regra ("Pedido acima de R$ 500" -> 500); padrão 500. */
function limitOf(ruleName: string): number {
  return maxMoney(ruleName) ?? 500
}

/**
 * Avalia as regras de passagem ATIVAS contra o que o cliente mandou em sequência.
 * Reconhece pelo nome da regra: desconto, reclamação/problema, atendente/pessoa e valor acima de R$ N.
 * Regras de texto livre não reconhecidas ficam para o modelo (marcador).
 */
export function detectHandoffRule(customerText: string, rules: string[]): HandoffHit | null {
  const q = normChat(customerText)
  for (const rule of rules) {
    const r = norm(rule)
    if (r.includes('desconto') && anyMatch(q, RE_DESCONTO, { negation: true })) {
      return {
        motivo: rule,
        mensagem: (resp) => `Vou chamar ${resp} para falar sobre condições especiais com você. Já já responde por aqui.`,
      }
    }
    if ((r.includes('reclama') || r.includes('problema')) && anyMatch(q, RE_RECLAMACAO, { negation: true, hypothetical: true })) {
      return { motivo: rule, mensagem: (resp) => `Sinto muito por isso. Vou passar sua conversa para ${resp}, que vai resolver com você o quanto antes.` }
    }
    if ((r.includes('atendente') || r.includes('pessoa') || r.includes('humano')) && anyMatch(q, RE_ATENDENTE, { negation: false })) {
      return { motivo: rule, mensagem: (resp) => `Claro, já estou passando sua conversa para ${resp}.` }
    }
    if ((r.includes('acima de') || r.includes('r$')) && /\d/.test(r)) {
      const valor = maxMoney(customerText)
      if (valor !== null && valor > limitOf(rule)) {
        return { motivo: rule, mensagem: (resp) => `Para um pedido desse valor prefiro chamar ${resp} para fechar os detalhes com você. Já já responde por aqui.` }
      }
    }
  }
  return null
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/** "sábado, 03/10/2026, 14:35" no fuso de São Paulo (para o modelo saber "hoje" e "agora"). */
export function formatAgora(d: Date): string {
  const p = spParts(d)
  const [y, m, day] = p.ymd.split('-')
  return `${DIAS_SEMANA[p.dow]}, ${day}/${m}/${y}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export const genericHandoffMessage = (responsavel: string) => `Claro, já estou passando sua conversa para ${responsavel}.`

// ---- Horário do agente ("Quando responder") ----

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
const DIA_TOKEN = '(dom(?:ingo)?|seg(?:unda)?(?:-feira)?|ter(?:ca)?(?:-feira)?|qua(?:rta)?(?:-feira)?|qui(?:nta)?(?:-feira)?|sex(?:ta)?(?:-feira)?|sab(?:ado)?)s?'
const DIA_NC = DIA_TOKEN.replace(/^\(/, '(?:') // sem grupo de captura (para uso no split)
const dayIndex =(tok: string): number => DIAS.indexOf(tok.slice(0, 3))

type Slot = { dias: Set<number>; ini: number; fim: number }
export type Expediente = { slots: Slot[] }

const ALL_DAYS = () => new Set([0, 1, 2, 3, 4, 5, 6])

function parseDias(clause: string): Set<number> {
  const dias = new Set<number>()
  let rest = clause
  const range = rest.match(new RegExp(`\\b${DIA_TOKEN}\\s*(?:a|ate|ate a|ate o|-|/)\\s*${DIA_TOKEN}\\b`))
  if (range) {
    let i = dayIndex(range[1] as string)
    const end = dayIndex(range[2] as string)
    for (let guard = 0; guard < 8; guard++) {
      dias.add(i)
      if (i === end) break
      i = (i + 1) % 7
    }
    rest = rest.replace(range[0], ' ')
  }
  for (const m of Array.from(rest.matchAll(new RegExp(`\\b${DIA_TOKEN}\\b`, 'g')))) dias.add(dayIndex(m[1] as string))
  if (/\b(?:fins?|finais) de semana\b/.test(rest)) {
    dias.add(0)
    dias.add(6)
  }
  if (/\bdias? uteis\b/.test(rest)) for (const d of [1, 2, 3, 4, 5]) dias.add(d)
  if (/\b(?:todos os dias|todo dia|diariamente|24h por dia|domingo a domingo|sempre aberto)\b/.test(clause)) for (let d = 0; d < 7; d++) dias.add(d)
  return dias
}

const T = '(\\d{1,2})(?:\\s*(?:h|hs|hrs|horas?)\\s*(\\d{2})?|:(\\d{2}))?'
const RANGE_RE = new RegExp(`${T}\\s*(?:as|a|ate as|ate|-|–|—)\\s*${T}`, 'g')

function parseIntervals(clause: string): { ini: number; fim: number }[] {
  const out: { ini: number; fim: number }[] = []
  const toMin = (h?: string, m1?: string, m2?: string) => Number(h) * 60 + Number(m1 ?? m2 ?? 0)
  for (const m of Array.from(clause.matchAll(RANGE_RE))) {
    const ini = toMin(m[1], m[2], m[3])
    const fim = toMin(m[4], m[5], m[6])
    if (Number(m[1]) > 24 || Number(m[4]) > 24 || ini === fim || ini >= 24 * 60 || fim > 24 * 60) continue
    out.push({ ini, fim })
  }
  if (out.length === 0 && /\b24\s*(?:h|horas)\b/.test(clause) && !/\b24h por dia\b/.test(clause)) out.push({ ini: 0, fim: 24 * 60 })
  if (out.length === 0 && /\b(?:24 ?\/ ?7|o dia todo|dia inteiro)\b/.test(clause)) out.push({ ini: 0, fim: 24 * 60 })
  return out
}

/**
 * Interpreta textos como "Seg a sáb, 8h às 18h", "Seg a sex 9h às 12h e 14h às 18h; sáb 9h às 13h",
 * "8:30-17:30", "todos os dias, 24h". Devolve null se não der para entender.
 */
export function parseExpediente(texto: string | null | undefined): Expediente | null {
  if (!texto) return null
  const q = norm(texto)
  // Cláusulas: ponto e vírgula, quebra de linha ou vírgula/“e” seguidos de um dia da semana.
  const clauses = q.split(new RegExp(`[;|\\n]|,\\s*(?=${DIA_NC}\\b(?:\\s*(?:a|ate|-)\\s*${DIA_NC})?\\s*[:,]?\\s*\\d)`)).map((c) => c.trim()).filter(Boolean)
  const slots: Slot[] = []
  for (const clause of clauses) {
    const intervals = parseIntervals(clause)
    if (intervals.length === 0) continue
    const dias = parseDias(clause)
    for (const iv of intervals) slots.push({ dias: dias.size ? new Set(dias) : ALL_DAYS(), ...iv })
  }
  return slots.length ? { slots } : null
}

export const HORARIO_ATENDIMENTO_PADRAO = 'Seg a sáb, 8h às 18h'

function isOpen(exp: Expediente, dow: number, min: number): boolean {
  return exp.slots.some((s) => {
    if (s.ini < s.fim) return s.dias.has(dow) && min >= s.ini && min < s.fim
    // vira a noite (ex.: 18h às 2h): vale no dia e na madrugada do dia seguinte
    return (s.dias.has(dow) && min >= s.ini) || (s.dias.has((dow + 6) % 7) && min < s.fim)
  })
}

/** O agente pode responder agora? `horario`: sempre | fora_expediente | fins_de_semana. */
export function agentMayReplyAt(horario: string, horarioAtendimento: string | null, at: Date): boolean {
  const p = spParts(at)
  if (horario === 'fins_de_semana') return p.dow === 0 || p.dow === 6
  if (horario === 'fora_expediente') {
    const exp = parseExpediente(horarioAtendimento ?? HORARIO_ATENDIMENTO_PADRAO)
    if (!exp) return true // não interpretável: trata como "sempre"
    return !isOpen(exp, p.dow, p.hour * 60 + p.minute)
  }
  return true
}
