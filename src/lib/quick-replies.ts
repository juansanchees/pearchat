// Respostas rápidas: regras puras (sem servidor, sem I/O), usadas pelo composer, pela gestão e pelas rotas.
// A substituição de variáveis ESPELHA `personalize` de src/server/engine/util.ts (que importa o banco e por isso
// não pode ir para o navegador). Se uma mudar, mude a outra.

export const QR_MAX_PER_SPACE = 100
export const QR_ATALHO_MIN = 2
export const QR_ATALHO_MAX = 24
export const QR_TEXTO_MAX = 2000
export const QR_PLACEHOLDER = '[preencha aqui]'

const ATALHO_RE = /^[a-z0-9-]+$/

export type QuickReplyDTO = {
  id: string
  atalho: string
  titulo: string | null
  texto: string
  ordem: number
  usos: number
}

export type QuickReplyVars = { empresa: string; horario: string }
export type QuickReplyList = { items: QuickReplyDTO[]; vars: QuickReplyVars }

/** Atalho normalizado (sem a barra de gatilho, minúsculo), ou a mensagem do problema. */
export function parseAtalho(raw: string): { ok: true; atalho: string } | { ok: false; error: string } {
  const atalho = raw.trim().replace(/^\/+/, '').toLowerCase()
  if (atalho.length < QR_ATALHO_MIN || atalho.length > QR_ATALHO_MAX) {
    return { ok: false, error: `O atalho precisa ter de ${QR_ATALHO_MIN} a ${QR_ATALHO_MAX} caracteres.` }
  }
  if (!ATALHO_RE.test(atalho)) return { ok: false, error: 'Use só letras sem acento, números e hífen no atalho.' }
  return { ok: true, atalho }
}

export const DEFAULT_QUICK_REPLIES: { atalho: string; texto: string }[] = [
  { atalho: 'ola', texto: 'Olá, {primeiro_nome}! Como posso ajudar?' },
  { atalho: 'horario', texto: 'Nosso horário de atendimento é {horario}.' },
  { atalho: 'endereco', texto: `Nosso endereço: ${QR_PLACEHOLDER}.` },
  { atalho: 'pix', texto: `Nossa chave Pix: ${QR_PLACEHOLDER}.` },
  { atalho: 'obrigado', texto: 'Obrigado pelo contato, {primeiro_nome}! Qualquer coisa, é só chamar.' },
]

type NameIds = { telefone?: string | null }

const firstName = (nome: string): string => nome.trim().split(/\s+/)[0] ?? ''

/** Nome "apresentável": vazio, igual ao telefone, só dígitos ou o "Contato" padrão viram ''. */
function displayName(nome: string | null | undefined, ids: NameIds = {}): string {
  const n = (nome ?? '').trim().replace(/\s+/g, ' ')
  if (!n) return ''
  if (ids.telefone && n === ids.telefone.trim()) return ''
  if (/^[+\d\s().-]+$/.test(n)) return ''
  if (n.toLowerCase() === 'contato') return ''
  return n
}

function personalizeName(template: string, nome: string | null | undefined, ids: NameIds): string {
  const full = displayName(nome, ids)
  const re = /\{(primeiro_nome|nome)\}/gi
  if (full) {
    const first = firstName(full)
    return template.replace(re, (_m, k: string) => (k.toLowerCase() === 'nome' ? full : first))
  }
  let t = template.replace(/^\s*\{(?:primeiro_nome|nome)\}[\s,;:!-]*/i, '')
  if (t !== template) t = t.charAt(0).toUpperCase() + t.slice(1)
  t = t.replace(/[ \t]*,?[ \t]*\{(?:primeiro_nome|nome)\}/gi, '')
  return t.replace(/[ \t]{2,}/g, ' ').trim()
}

export type QuickReplyContext = { nome?: string | null; telefone?: string | null; empresa?: string | null; horario?: string | null }

/**
 * Texto pronto para o campo de mensagem. {primeiro_nome}/{nome} somem de forma coerente quando o contato não tem nome;
 * {empresa}/{horario} vazios viram o marcador "[preencha aqui]" (que o composer deixa selecionado).
 * `select` = trecho do primeiro marcador (para o usuário já digitar por cima), ou null.
 */
export function expandQuickReply(texto: string, ctx: QuickReplyContext): { text: string; select: [number, number] | null } {
  let t = personalizeName(texto, ctx.nome, { telefone: ctx.telefone })
  const empresa = (ctx.empresa ?? '').trim()
  const horario = (ctx.horario ?? '').trim()
  // Função como substituto: "$&" e "$1" no valor não são interpretados.
  t = t.replace(/\{empresa\}/gi, () => empresa || QR_PLACEHOLDER).replace(/\{horario\}/gi, () => horario || QR_PLACEHOLDER)
  const at = t.indexOf(QR_PLACEHOLDER)
  return { text: t, select: at >= 0 ? [at, at + QR_PLACEHOLDER.length] : null }
}

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Filtra pelo que foi digitado depois da barra: atalhos que começam com o termo primeiro, depois os que contêm. */
export function filterQuickReplies(items: QuickReplyDTO[], query: string): QuickReplyDTO[] {
  const q = norm(query.trim())
  if (!q) return items
  const starts: QuickReplyDTO[] = []
  const contains: QuickReplyDTO[] = []
  for (const it of items) {
    if (it.atalho.startsWith(q)) starts.push(it)
    else if (it.atalho.includes(q) || norm(it.titulo ?? '').includes(q) || norm(it.texto).includes(q)) contains.push(it)
  }
  return [...starts, ...contains]
}
