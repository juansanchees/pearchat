// Telefones de qualquer país (módulo puro: roda no servidor e no navegador; nenhuma dependência).
//
// Regra de ouro: um número que JÁ vem com DDI (com "+", com "00" ou com 12+ dígitos que começam por um DDI válido)
// NUNCA ganha DDI nenhum. Só um número digitado SEM DDI ganha o DDI padrão do espaço (Workspace.ddiPadrao, padrão 55).
// O "1" do México e o "9" do Brasil/Argentina NÃO são acrescentados nem removidos aqui: a Evolution API (createJid, 2.3.7)
// já trata os dois na hora de enviar; aqui eles só entram nas VARIANTES usadas para achar o mesmo contato já gravado.

export const DEFAULT_DDI = '55'
export const MAX_PHONE_DIGITS = 15

export const onlyDigits = (s: string): string => s.replace(/\D/g, '')

// ---------------------------------------------------------------- DDIs (códigos de país do plano E.164)

const ONE_DIGIT = ['1', '7']
const TWO_DIGITS = '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' ')
const THREE_DIGITS = [
  '211 212 213 216 218',
  '220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258',
  '260 261 262 263 264 265 266 267 268 269 290 291 297 298 299',
  '350 351 352 353 354 355 356 357 358 359',
  '370 371 372 373 374 375 376 377 378 380 381 382 383 385 386 387 389 420 421 423',
  '500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599',
  '670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692',
  '850 852 853 855 856 880 886',
  '960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998',
]
  .join(' ')
  .split(' ')

const DDI_SET = new Set<string>([...ONE_DIGIT, ...TWO_DIGITS, ...THREE_DIGITS])

/** DDI no começo de uma sequência de dígitos (os códigos não são prefixo uns dos outros), ou null. */
export function ddiOf(digits: string): string | null {
  for (const n of [1, 2, 3]) {
    const p = digits.slice(0, n)
    if (p.length === n && DDI_SET.has(p)) return p
  }
  return null
}

export const isValidDdi = (ddi: string): boolean => DDI_SET.has(ddi)

// ---------------------------------------------------------------- Países conhecidos (formato e validade)

type Country = {
  iso: string
  ddi: string
  nome: string
  /** Quantidade de dígitos do número nacional (sem o DDI). */
  national: number[]
  /** Forma do número nacional (além do tamanho). */
  ok?: (n: string) => boolean
  /** Formata o número nacional (sem o DDI). */
  fmt: (n: string) => string
}

/** DDDs em uso no Brasil. */
const BR_DDD = new Set(
  '11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '),
)
export const isBrazilianDdd = (ddd: string): boolean => BR_DDD.has(ddd)

const split = (n: string, sizes: number[], sep = ' '): string => {
  const out: string[] = []
  let i = 0
  for (const s of sizes) {
    if (i >= n.length) break
    out.push(n.slice(i, i + s))
    i += s
  }
  if (i < n.length) out.push(n.slice(i))
  return out.join(sep)
}

const COUNTRIES: Country[] = [
  {
    iso: 'BR',
    ddi: '55',
    nome: 'Brasil',
    national: [10, 11],
    ok: (n) => BR_DDD.has(n.slice(0, 2)) && (n.length === 11 ? n[2] === '9' : /[2-9]/.test(n[2] ?? '')),
    fmt: (n) => {
      const local = n.slice(2)
      const cut = Math.max(local.length - 4, 0)
      return `${n.slice(0, 2)} ${local.slice(0, cut)}-${local.slice(cut)}`
    },
  },
  {
    iso: 'MX',
    ddi: '52',
    nome: 'México',
    national: [10, 11],
    // 10 dígitos (formato atual) ou 11 com o "1" antigo de celular na frente.
    ok: (n) => (n.length === 11 ? /^1[2-9]/.test(n) : /^[2-9]/.test(n)),
    fmt: (n) => {
      const one = n.length === 11 ? '1 ' : ''
      const m = n.length === 11 ? n.slice(1) : n
      // Cidade do México, Guadalajara e Monterrey têm DDD de 2 dígitos (55, 33, 81); as demais, 3.
      return one + (/^(55|33|81)/.test(m) ? split(m, [2, 4, 4]) : split(m, [3, 3, 4]))
    },
  },
  {
    iso: 'AR',
    ddi: '54',
    nome: 'Argentina',
    national: [10, 11],
    ok: (n) => (n.length === 11 ? /^9[1-9]/.test(n) : /^[1-9]/.test(n)),
    fmt: (n) => {
      const nine = n.length === 11 ? '9 ' : ''
      const m = n.length === 11 ? n.slice(1) : n
      const area = m.startsWith('11') ? 2 : 3
      const local = m.slice(area)
      const cut = Math.max(local.length - 4, 0)
      return `${nine}${m.slice(0, area)} ${local.slice(0, cut)}-${local.slice(cut)}`
    },
  },
  {
    iso: 'US',
    ddi: '1',
    nome: 'Estados Unidos / Canadá',
    national: [10],
    ok: (n) => /^[2-9]\d\d[2-9]/.test(n),
    fmt: (n) => `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`,
  },
  { iso: 'PT', ddi: '351', nome: 'Portugal', national: [9], ok: (n) => /^[239]/.test(n), fmt: (n) => split(n, [3, 3, 3]) },
  { iso: 'ES', ddi: '34', nome: 'Espanha', national: [9], ok: (n) => /^[6-9]/.test(n), fmt: (n) => split(n, [3, 3, 3]) },
  { iso: 'CO', ddi: '57', nome: 'Colômbia', national: [10], ok: (n) => /^(3|60)/.test(n), fmt: (n) => split(n, [3, 3, 4]) },
  { iso: 'CL', ddi: '56', nome: 'Chile', national: [9], ok: (n) => /^[2-9]/.test(n), fmt: (n) => split(n, [1, 4, 4]) },
  { iso: 'PE', ddi: '51', nome: 'Peru', national: [8, 9], ok: (n) => /^[1-9]/.test(n), fmt: (n) => (n.length === 9 ? split(n, [3, 3, 3]) : split(n, [1, 3, 4])) },
]

const BY_DDI = new Map(COUNTRIES.map((c) => [c.ddi, c]))

/** Países oferecidos em "DDI padrão" (Configurações): os com formato próprio + alguns comuns nos atendimentos. */
export const DDI_OPTIONS: { ddi: string; nome: string }[] = [
  ...COUNTRIES.map((c) => ({ ddi: c.ddi, nome: c.nome })),
  { ddi: '598', nome: 'Uruguai' },
  { ddi: '595', nome: 'Paraguai' },
  { ddi: '591', nome: 'Bolívia' },
  { ddi: '593', nome: 'Equador' },
  { ddi: '58', nome: 'Venezuela' },
  { ddi: '507', nome: 'Panamá' },
  { ddi: '506', nome: 'Costa Rica' },
  { ddi: '44', nome: 'Reino Unido' },
  { ddi: '49', nome: 'Alemanha' },
  { ddi: '33', nome: 'França' },
  { ddi: '39', nome: 'Itália' },
]

export const ddiLabel = (ddi: string): string => `${DDI_OPTIONS.find((o) => o.ddi === ddi)?.nome ?? 'Outro país'} (+${ddi})`

/** Valor aceito em Workspace.ddiPadrao (lista fechada de DDIs válidos). */
export const isAllowedDefaultDdi = (ddi: string): boolean => /^\d{1,3}$/.test(ddi) && DDI_SET.has(ddi)

const nationalOk = (c: Country, n: string): boolean => /^\d+$/.test(n) && c.national.includes(n.length) && (c.ok ? c.ok(n) : true)

/** Número "completo" (DDI + nacional, só dígitos) é plausível? Países conhecidos conferem tamanho e forma; os demais, só o tamanho. */
function internationalOk(d: string): boolean {
  if (d.length < 8 || d.length > MAX_PHONE_DIGITS) return false
  const ddi = ddiOf(d)
  if (!ddi) return false
  const rest = d.slice(ddi.length)
  const c = BY_DDI.get(ddi)
  return c ? nationalOk(c, rest) : rest.length >= 4 && rest[0] !== '0'
}

// ---------------------------------------------------------------- Normalização

/**
 * Texto digitado/importado -> E.164 ("+5215512345678"), ou null se não parece um telefone.
 *  - Com "+" ou "00": é internacional, vale como está (nada é acrescentado).
 *  - Sem DDI (curto o bastante para ser nacional no país padrão): ganha `defaultDdi`.
 *  - Mais longo que um nacional do país padrão: tratado como já tendo DDI (inclusive de outro país) e NUNCA ganha DDI.
 * Números de 11 dígitos que servem como nacional no país padrão E como internacional de outro (BR × EUA) ficam com o país padrão
 * quando a FORMA nacional confere (ex.: 11 9xxxx-xxxx), senão são lidos como internacionais.
 */
export function normalizePhoneE164(raw: string, defaultDdi: string = DEFAULT_DDI): string | null {
  const text = raw.trim().replace(/^'/, '')
  if (!text) return null
  const explicit = text.startsWith('+') || text.startsWith('00')
  let d = onlyDigits(text)
  if (text.startsWith('00')) d = d.slice(2)
  if (!d) return null
  if (explicit) return internationalOk(d) ? `+${d}` : null

  const ddi = isValidDdi(defaultDdi) ? defaultDdi : DEFAULT_DDI
  // Prefixos de tronco: "0" + DDD (Brasil), "044"/"045"/"01" (México).
  if (ddi === '52') {
    const mx = /^(?:04[45]|01)(\d{10})$/.exec(d)
    if (mx) d = mx[1]
  }
  if (d.startsWith('0') && d.length >= 11) d = d.replace(/^0+/, '')
  if (!d) return null

  const def = BY_DDI.get(ddi)
  const maxNat = def ? Math.max(...def.national) : 11
  // 1) Cabe como número nacional do país padrão -> ganha o DDI padrão.
  if (d.length <= maxNat) {
    if (def ? nationalOk(def, d) : d.length >= 7 && d.length <= 11) {
      const full = `${ddi}${d}`
      if (full.length <= MAX_PHONE_DIGITS) return `+${full}`
    }
    // Não serve como nacional: pode ser um internacional curto de um país CONHECIDO (ex.: 11 dígitos dos EUA com o 1 na
    // frente). País desconhecido não vale aqui: um número nacional digitado errado não vira "+91…" por acaso.
    const other = ddiOf(d)
    return other && BY_DDI.has(other) && internationalOk(d) ? `+${d}` : null
  }
  // 2) Mais longo que um nacional: já traz DDI (o do país padrão ou o de outro país). Nunca ganha DDI.
  return internationalOk(d) ? `+${d}` : null
}

// ---------------------------------------------------------------- Variantes (achar o mesmo contato já gravado)

/**
 * Formas equivalentes do mesmo número, SÓ para procurar um contato existente (nunca para gravar ou enviar):
 * Brasil com/sem o 9º dígito; México +521… × +52…; Argentina +549… × +54….
 */
export function phoneVariants(e164: string): string[] {
  const d = onlyDigits(e164)
  const out = new Set<string>([`+${d}`])
  if (d.startsWith('55')) {
    const rest = d.slice(2)
    if (rest.length === 11 && rest[2] === '9') out.add(`+55${rest.slice(0, 2)}${rest.slice(3)}`)
    else if (rest.length === 10 && /[6-9]/.test(rest[2])) out.add(`+55${rest.slice(0, 2)}9${rest.slice(2)}`)
  } else if (d.startsWith('52')) {
    if (d.length === 13 && d[2] === '1') out.add(`+52${d.slice(3)}`)
    else if (d.length === 12) out.add(`+521${d.slice(2)}`)
  } else if (d.startsWith('54')) {
    if (d.length === 13 && d[2] === '9') out.add(`+54${d.slice(3)}`)
    else if (d.length === 12) out.add(`+549${d.slice(2)}`)
  }
  return Array.from(out)
}

/** Todos os formatos sob os quais o mesmo contato pode estar gravado (com/sem DDI padrão, com/sem o dígito extra do país). */
export function phoneCandidates(raw: string, defaultDdi: string = DEFAULT_DDI): string[] {
  const set = new Set<string>()
  const add = (p: string | null) => p && phoneVariants(p).forEach((v) => set.add(v))
  const text = raw.trim()
  const explicit = text.startsWith('+') || text.startsWith('00')
  let digits = onlyDigits(text)
  if (text.startsWith('00')) digits = digits.slice(2)
  digits = digits.replace(/^0+/, '')
  add(normalizePhoneE164(raw, defaultDdi))
  if (digits) add(`+${digits}`)
  if (!explicit && digits && digits.length <= 11) add(`+${isValidDdi(defaultDdi) ? defaultDdi : DEFAULT_DDI}${digits}`)
  return Array.from(set)
}

// ---------------------------------------------------------------- Exibição

/** Dígitos de um número desconhecido, em grupos de 3 (o último pode ter 4). */
function groupGeneric(rest: string): string {
  const parts: string[] = []
  let i = 0
  while (rest.length - i > 4) {
    parts.push(rest.slice(i, i + 3))
    i += 3
  }
  parts.push(rest.slice(i))
  return parts.join(' ')
}

/** "+5511987654321" -> "+55 11 98765-4321"; "+5215512345678" -> "+52 1 551 2345678"... por país conhecido; senão "+DDI" e dígitos agrupados. */
export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return ''
  const d = onlyDigits(e164)
  if (!d) return ''
  const ddi = ddiOf(d)
  // Mais que 15 dígitos não é telefone (um LID gravado por engano): mostra como está.
  if (!ddi || d.length > MAX_PHONE_DIGITS) return `+${d}`
  const rest = d.slice(ddi.length)
  const c = BY_DDI.get(ddi)
  if (c && c.national.includes(rest.length)) return `+${ddi} ${c.fmt(rest)}`
  return `+${ddi} ${groupGeneric(rest)}`
}

/** Nome do país do número ("México"), quando conhecido. */
export function countryNameOf(e164: string | null | undefined): string | null {
  const d = onlyDigits(e164 ?? '')
  const ddi = ddiOf(d)
  return ddi ? (DDI_OPTIONS.find((o) => o.ddi === ddi)?.nome ?? null) : null
}

// ---------------------------------------------------------------- Campo de telefone (máscara de digitação)

/** Máscara enquanto digita, pelo país padrão do negócio. Começando por "+", mostra "+DDI número" (internacional). */
export function maskPhoneInput(raw: string, defaultDdi: string = DEFAULT_DDI): string {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('+')) {
    const d = onlyDigits(trimmed).slice(0, MAX_PHONE_DIGITS)
    if (!d) return '+'
    const ddi = ddiOf(d)
    return ddi ? `+${ddi}${d.length > ddi.length ? ` ${groupGeneric(d.slice(ddi.length))}` : ''}` : `+${d}`
  }
  let d = onlyDigits(trimmed)
  if (d.length === 0) return ''
  const ddi = isValidDdi(defaultDdi) ? defaultDdi : DEFAULT_DDI
  if (ddi === '55') {
    // Brasil: (11) 98765-4321; aceita colar com 55.
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
    d = d.slice(0, 11)
    if (d.length <= 2) return `(${d}`
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  }
  if (d.length > 11 && d.startsWith(ddi)) d = d.slice(ddi.length)
  d = d.slice(0, 11)
  return ddi === '1' ? (d.length <= 3 ? d : d.length <= 6 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`) : groupGeneric(d)
}

/** Mensagem de erro do campo (null = ok). `masked` é o texto do campo. */
export function phoneInputError(masked: string, defaultDdi: string = DEFAULT_DDI): string | null {
  const digits = onlyDigits(masked)
  const withPlus = masked.trimStart().startsWith('+')
  if (!digits) return 'Informe o WhatsApp.'
  if (!normalizePhoneE164(withPlus ? `+${digits}` : digits, defaultDdi)) {
    return withPlus
      ? 'Esse número internacional não parece válido.'
      : defaultDdi === '55' || !isValidDdi(defaultDdi)
        ? 'Informe o WhatsApp com DDD.'
        : 'Informe o WhatsApp com o código da cidade ou comece por + e o código do país.'
  }
  if (/^(\d)\1+$/.test(digits)) return 'Esse número não parece válido.'
  return null
}
