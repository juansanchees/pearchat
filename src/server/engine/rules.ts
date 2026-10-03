import { norm, spParts } from './util'

// ---- Regras de passagem para humano ----

export type HandoffHit = { motivo: string; mensagem: (responsavel: string) => string }

const KW_DESCONTO = ['desconto', 'mais barato', 'promocao', 'abatimento', 'baratinho', 'fazer por menos', 'ta caro', 'muito caro', 'negociar o preco', 'negociar preco', 'abaixar o preco']
const KW_RECLAMACAO = [
  'reclamacao', 'reclamar', 'reclamando', 'insatisfeito', 'insatisfeita', 'absurdo', 'pessimo', 'pessima', 'horrivel', 'inaceitavel', 'decepcionado', 'decepcionada',
  'chegou errado', 'veio errado', 'veio errada', 'chegou errada', 'chegou estragado', 'chegou estragada', 'nao gostei', 'quero meu dinheiro', 'reembolso', 'estorno', 'devolucao', 'processar', 'procon',
  'atrasou', 'ainda nao chegou', 'nunca chegou', 'problema com o pedido', 'problema com meu pedido',
]
const KW_ATENDENTE = ['atendente', 'humano', 'falar com uma pessoa', 'falar com pessoa', 'falar com alguem', 'pessoa de verdade', 'falar com o dono', 'falar com a dona', 'falar com o responsavel', 'falar com a responsavel', 'gerente', 'supervisor', 'quero falar com', 'passa para uma pessoa', 'chama alguem']

const hasAny = (q: string, kws: string[]) => kws.some((k) => q.includes(k))

/** Maior valor em reais citado no texto ("R$ 600", "R$1.250,50", "800 reais"), ou null. */
export function maxMoney(text: string): number | null {
  const q = text.toLowerCase()
  const values: number[] = []
  const parse = (raw: string): number | null => {
    const n = Number(raw.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  for (const m of Array.from(q.matchAll(/r\$\s*(\d[\d.]*(?:,\d{1,2})?)/g))) {
    const v = parse(m[1] ?? '')
    if (v !== null) values.push(v)
  }
  for (const m of Array.from(q.matchAll(/(\d[\d.]*(?:,\d{1,2})?)\s*(?:reais|real|pila|conto)/g))) {
    const v = parse(m[1] ?? '')
    if (v !== null) values.push(v)
  }
  return values.length ? Math.max(...values) : null
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
  const q = norm(customerText)
  for (const rule of rules) {
    const r = norm(rule)
    if (r.includes('desconto') && hasAny(q, KW_DESCONTO)) {
      return {
        motivo: rule,
        mensagem: (resp) => `Vou chamar ${resp} para falar sobre condições especiais com você. Já já responde por aqui.`,
      }
    }
    if ((r.includes('reclama') || r.includes('problema')) && hasAny(q, KW_RECLAMACAO)) {
      return { motivo: rule, mensagem: (resp) => `Sinto muito por isso. Vou passar sua conversa para ${resp}, que vai resolver com você o quanto antes.` }
    }
    if ((r.includes('atendente') || r.includes('pessoa') || r.includes('humano')) && hasAny(q, KW_ATENDENTE)) {
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

export const genericHandoffMessage = (responsavel: string) => `Claro, já estou passando sua conversa para ${responsavel}.`

// ---- Horário do agente ("Quando responder") ----

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

type Expediente = { dias: Set<number>; ini: number; fim: number }

/** Interpreta textos como "Seg a sáb, 8h às 18h". Devolve null se não der para entender. */
export function parseExpediente(texto: string | null | undefined): Expediente | null {
  if (!texto) return null
  const q = norm(texto)
  const horas = Array.from(q.matchAll(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/g)).slice(0, 2)
  if (horas.length < 2) return null
  const toMin = (m: RegExpMatchArray) => Number(m[1]) * 60 + Number(m[2] ?? 0)
  const ini = toMin(horas[0] as RegExpMatchArray)
  const fim = toMin(horas[1] as RegExpMatchArray)
  if (!(ini >= 0 && fim <= 24 * 60 && ini < fim)) return null

  const dias = new Set<number>()
  const range = q.match(/\b(dom|seg|ter|qua|qui|sex|sab)[a-z]*\s*(?:a|ate|-)\s*(dom|seg|ter|qua|qui|sex|sab)/)
  if (range) {
    let i = DIAS.indexOf(range[1] as string)
    const end = DIAS.indexOf(range[2] as string)
    for (let guard = 0; guard < 8; guard++) {
      dias.add(i)
      if (i === end) break
      i = (i + 1) % 7
    }
  } else if (/todos os dias|diariamente|24h por dia/.test(q)) {
    for (let i = 0; i < 7; i++) dias.add(i)
  } else {
    for (const m of Array.from(q.matchAll(/\b(dom|seg|ter|qua|qui|sex|sab)[a-z]*/g))) dias.add(DIAS.indexOf(m[1] as string))
    if (dias.size === 0) for (let i = 0; i < 7; i++) dias.add(i)
  }
  return { dias, ini, fim }
}

export const HORARIO_ATENDIMENTO_PADRAO = 'Seg a sáb, 8h às 18h'

/** O agente pode responder agora? `horario`: sempre | fora_expediente | fins_de_semana. */
export function agentMayReplyAt(horario: string, horarioAtendimento: string | null, at: Date): boolean {
  const p = spParts(at)
  if (horario === 'fins_de_semana') return p.dow === 0 || p.dow === 6
  if (horario === 'fora_expediente') {
    const exp = parseExpediente(horarioAtendimento ?? HORARIO_ATENDIMENTO_PADRAO)
    if (!exp) return true // não interpretável: trata como "sempre"
    const min = p.hour * 60 + p.minute
    const aberto = exp.dias.has(p.dow) && min >= exp.ini && min < exp.fim
    return !aberto
  }
  return true
}
