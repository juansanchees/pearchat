const KNOWN: Record<string, string> = {
  lead: 'Lead',
  leads: 'Lead',
  cliente: 'Cliente',
  clientes: 'Cliente',
  vip: 'VIP',
  casamento: 'Casamento',
}

const MAX_TAGS = 10
const MAX_TAG_LENGTH = 30

/** "vip" -> "VIP"; "festa infantil" -> "Festa infantil". Vazio devolve null. */
export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
  if (!t) return null
  return KNOWN[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

/** Normaliza, remove duplicadas (sem diferenciar caixa) e limita a quantidade. */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    const tag = normalizeTag(r)
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(tag)
  }
  return out.slice(0, MAX_TAGS)
}

/** Variações de caixa para comparar com `tags` do banco (hasSome é sensível a maiúsculas). */
export function tagVariants(tag: string): string[] {
  const canon = normalizeTag(tag) ?? tag
  return Array.from(new Set([canon, canon.toLowerCase(), canon.toUpperCase(), tag]))
}

/** Filtro da UI -> etiqueta canônica. */
export const FILTER_TAGS = { cliente: 'Cliente', lead: 'Lead', vip: 'VIP' } as const
export type FilterTag = keyof typeof FILTER_TAGS

/** Aceita "cliente", "Clientes", "LEAD"... */
export function parseFilterTag(raw: string): FilterTag | null {
  const t = raw.trim().toLowerCase().replace(/s$/, '')
  return t === 'cliente' || t === 'lead' || t === 'vip' ? t : null
}
