// Regras de modelos de mensagem da Cloud API. Funções puras (sem I/O), usadas no servidor e no navegador.

/** Máximo de caracteres do corpo de um modelo (Meta: 1024). */
export const TEMPLATE_BODY_MAX = 1024
/** Nome: minúsculas, números e "_" (Meta: até 512; o PearChat limita a 60 e exige letra no início). */
export const TEMPLATE_NAME_RE = /^[a-z][a-z0-9_]{2,59}$/

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g
const ANY_VAR_RE = /\{\{[^}]*\}\}/g

/** Números das variáveis {{n}} presentes no texto, em ordem de aparição (sem repetição). */
export function templateVarIndexes(body: string): number[] {
  const seen: number[] = []
  for (const m of Array.from(body.matchAll(VAR_RE))) {
    const n = Number(m[1])
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

/** Quantidade de variáveis (maior índice {{n}}). */
export function countTemplateVars(body: string): number {
  return Math.max(0, ...templateVarIndexes(body))
}

export type TemplateDraft = { name?: string; category: 'MARKETING' | 'UTILIDADE'; body: string; examples: string[] }

/** Erros (em português) que a Meta recusaria. Lista vazia = pode enviar. */
export function validateTemplateDraft(d: TemplateDraft): string[] {
  const errs: string[] = []
  const body = d.body.trim()
  if (d.name !== undefined && d.name !== '' && !TEMPLATE_NAME_RE.test(d.name)) {
    errs.push('O nome deve ter só letras minúsculas, números e _ (mínimo 3 caracteres, começando por letra).')
  }
  if (!body) errs.push('Escreva o texto do modelo.')
  if (body.length > TEMPLATE_BODY_MAX) errs.push(`O texto passa de ${TEMPLATE_BODY_MAX} caracteres.`)
  // Qualquer {{...}} que não seja número ({{nome}}) não é aceito pelo PearChat (variáveis posicionais apenas).
  const stray = Array.from(body.matchAll(ANY_VAR_RE)).filter((m) => !/^\{\{\s*\d+\s*\}\}$/.test(m[0]))
  if (stray.length) errs.push('Use variáveis numeradas: {{1}}, {{2}}…')
  const idx = templateVarIndexes(body)
  const n = Math.max(0, ...idx)
  for (let i = 1; i <= n; i++) if (!idx.includes(i)) errs.push(`As variáveis precisam ser sequenciais: falta {{${i}}}.`)
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body)) errs.push('O texto não pode começar com uma variável.')
  if (/\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(body)) errs.push('O texto não pode terminar com uma variável.')
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) errs.push('Não coloque duas variáveis coladas; escreva um texto entre elas.')
  if (n > 0) {
    if (d.examples.length < n || d.examples.slice(0, n).some((e) => !e.trim())) errs.push('Dê um exemplo de preenchimento para cada variável.')
    if (d.examples.slice(0, n).some((e) => /[\r\n\t]/.test(e) || /\s{4,}/.test(e))) errs.push('Os exemplos não podem ter quebra de linha, tabulação nem 4 espaços seguidos.')
  }
  return errs
}

/** Gera um nome válido a partir de um texto livre ("Lembrete de horário" -> "lembrete_de_horario"). */
export function slugifyTemplateName(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
  const withLetter = /^[a-z]/.test(s) ? s : `m_${s}`
  return withLetter.length >= 3 ? withLetter : `${withLetter}_modelo`
}

type Comp = { type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; url?: string; text?: string }> }

function comps(components: unknown): Comp[] {
  return Array.isArray(components) ? (components as Comp[]) : []
}

/**
 * O PearChat só preenche variáveis do CORPO ({{1}}, {{2}}...). Modelos com cabeçalho de mídia/variável, botão com variável
 * ou variáveis nomeadas não podem ser usados em disparos. Devolve o motivo ou null.
 */
export function templateUnsupportedReason(components: unknown): string | null {
  const list = comps(components)
  if (list.length === 0) return null
  for (const c of list) {
    const type = String(c.type ?? '').toUpperCase()
    if (type === 'HEADER') {
      const fmt = String(c.format ?? 'TEXT').toUpperCase()
      if (fmt !== 'TEXT') return 'Este modelo tem cabeçalho com imagem, vídeo ou documento, que o PearChat ainda não envia.'
      if (/\{\{[^}]*\}\}/.test(c.text ?? '')) return 'Este modelo tem variável no cabeçalho, que o PearChat ainda não preenche.'
    }
    if (type === 'BODY') {
      const text = c.text ?? ''
      if (Array.from(text.matchAll(ANY_VAR_RE)).some((m) => !/^\{\{\s*\d+\s*\}\}$/.test(m[0]))) return 'Este modelo usa variáveis com nome, que o PearChat ainda não preenche.'
    }
    if (type === 'BUTTONS') {
      for (const b of c.buttons ?? []) {
        if (/\{\{/.test(b.url ?? '')) return 'Este modelo tem botão com variável, que o PearChat ainda não preenche.'
        if (String(b.type ?? '').toUpperCase() === 'COPY_CODE' || String(b.type ?? '').toUpperCase() === 'OTP') return 'Este modelo tem botão de código, que o PearChat ainda não envia.'
      }
    }
  }
  return null
}

export type LocalTemplateStatus = 'APROVADO' | 'EM_ANALISE' | 'REJEITADO' | 'PAUSADO' | 'DESATIVADO'

/** Status da Meta -> status local. null = ignorar (ex.: autenticação não suportada). */
export function metaStatusToLocal(status: string | undefined): LocalTemplateStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
    case 'FLAGGED':
      return 'APROVADO'
    case 'REJECTED':
      return 'REJEITADO'
    case 'PAUSED':
    case 'LIMIT_EXCEEDED':
      return 'PAUSADO'
    case 'DISABLED':
    case 'PENDING_DELETION':
    case 'DELETED':
      return 'DESATIVADO'
    default:
      // PENDING, IN_APPEAL e qualquer valor novo: ainda sem decisão.
      return 'EM_ANALISE'
  }
}

/** Modelos sugeridos ao conectar (utilidade). O dono cria com um clique: nunca são criados sozinhos. */
export const SUGGESTED_TEMPLATES: Array<{ name: string; category: 'UTILIDADE'; body: string; examples: string[]; titulo: string }> = [
  {
    name: 'lembrete_agendamento',
    titulo: 'Lembrete de agendamento',
    category: 'UTILIDADE',
    body: 'Oi {{1}}, passando para lembrar do seu horário de {{2}}, {{3}} às {{4}}. Responda 1 para confirmar ou 2 para remarcar.',
    examples: ['Ana', 'Corte de cabelo', 'amanhã', '14:00'],
  },
  {
    name: 'retomada_conversa',
    titulo: 'Retomada de conversa',
    category: 'UTILIDADE',
    body: 'Oi {{1}}, continuamos de onde paramos? Se ainda quiser seguir, é só responder por aqui.',
    examples: ['Ana'],
  },
]
