// Regras puras do endereço (sem banco): usadas também pela tela do dono, no navegador.

// Endereço do link público de agendamento: /a/<slug>. Minúsculas, sem acento, hífens, 3 a 40 caracteres.

export const SLUG_MIN = 3
export const SLUG_MAX = 40

/** Palavras que não podem virar endereço (rotas do app, páginas legais e nomes que confundem). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api', 'login', 'registro', 'a', 'admin', 'app', 'whatsapp', 'agenda', 'contatos', 'privacidade', 'termos',
  'bem-vindo', 'brand', 'recuperar-senha', 'redefinir-senha', 'verificar-email', 'www', 'static', 'public',
  'favicon', 'manifest', 'robots', 'sitemap', 'suporte', 'ajuda', 'pearchat', 'dashboard', 'conta',
  'configuracoes', 'plano', 'resultados', 'conversas', 'auth', 'dev', 'health', 'status', 'home', 'index',
  'inicio', 'null', 'undefined', 'sair', 'logout', 'cadastro', 'termos-de-uso', 'politica-de-privacidade',
])

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Nome do negócio -> slug base (pode ser curto demais ou reservado: use generateSlugCandidate). */
export function slugify(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
}

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string }

/** Valida o texto digitado pelo dono (não consulta o banco). Aceita maiúsculas e espaços nas pontas. */
export function validateSlug(input: string): SlugCheck {
  const slug = input.trim().toLowerCase()
  if (slug.length < SLUG_MIN) return { ok: false, message: `Use pelo menos ${SLUG_MIN} caracteres.` }
  if (slug.length > SLUG_MAX) return { ok: false, message: `Use no máximo ${SLUG_MAX} caracteres.` }
  if (!SLUG_RE.test(slug)) {
    return { ok: false, message: 'Use só letras minúsculas sem acento, números e hífens (sem hífen no começo, no fim ou repetido).' }
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, message: 'Esse endereço é reservado. Escolha outro.' }
  return { ok: true, slug }
}

/** n-ésimo candidato a partir do nome: base, base-2, base-3... sempre dentro de 3..40 e fora da lista de reservados. */
export function generateSlugCandidate(nome: string, n: number): string {
  let base = slugify(nome)
  if (base.length < SLUG_MIN) base = base ? `${base}-agenda`.slice(0, SLUG_MAX) : 'meu-negocio'
  if (base.length < SLUG_MIN) base = 'meu-negocio'
  if (n <= 1 && !RESERVED_SLUGS.has(base)) return base
  const suffix = `-${Math.max(n, 2)}`
  return `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`
}
