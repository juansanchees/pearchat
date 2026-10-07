import { z } from 'zod'
import { detectDelimiter, parseCsv } from './csv'
import type { CsvRecord } from './csv'
import { DEFAULT_DDI } from '@/lib/phone'
import { normalizePhone } from './phone'
import { normalizeTags } from './tags'
import type { ImportError } from './types'

export const MAX_IMPORT_ROWS = 20000
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

export type ImportRow = { line: number; name: string; phone: string; email: string | null; tags: string[] }

export type ParsedImport =
  | { ok: true; rows: ImportRow[]; erros: ImportError[]; ignorados: number }
  | { ok: false; status: 400 | 413; message: string }

type Field = 'name' | 'phone' | 'email' | 'tags'

const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['nome', 'name', 'nome completo', 'cliente', 'contato'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'tel', 'numero', 'telefone whatsapp'],
  email: ['email', 'e-mail', 'mail'],
  tags: ['etiquetas', 'etiqueta', 'tags', 'tag', 'marcadores'],
}

const emailSchema = z.string().email().max(160)

/** "E-mail" -> "e-mail"; "Número" -> "numero" */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

export function mapHeader(cells: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {}
  cells.forEach((cell, i) => {
    const key = normalizeHeader(cell)
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      if (map[field] === undefined && HEADER_ALIASES[field].includes(key)) map[field] = i
    }
  })
  return map
}

/** A exportação prefixa ' em células que o Excel leria como fórmula (=, +, -, @); aqui o prefixo sai (round-trip). */
const unneutralize = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v)

const cellAt = (rec: CsvRecord, idx: number | undefined) =>
  idx === undefined ? '' : unneutralize((rec.cells[idx] ?? '').trim())

type RowResult = { row: ImportRow } | { erro: ImportError }

function buildRow(rec: CsvRecord, cols: Partial<Record<Field, number>>, ddi: string): RowResult {
  const fail = (motivo: string) => ({ erro: { linha: rec.line, motivo } })
  const name = cellAt(rec, cols.name).slice(0, 120)
  if (!name) return fail('Nome ausente')
  const rawPhone = cellAt(rec, cols.phone)
  if (!rawPhone) return fail('Telefone ausente')
  const phone = normalizePhone(rawPhone, ddi)
  if (!phone) return fail('Telefone inválido')
  const rawEmail = cellAt(rec, cols.email)
  if (rawEmail && !emailSchema.safeParse(rawEmail).success) return fail('E-mail inválido')
  const tags = normalizeTags(cellAt(rec, cols.tags).split(/[,;|]/))
  return { row: { line: rec.line, name, phone, email: rawEmail || null, tags } }
}

/** Junta linhas repetidas do arquivo (mesmo telefone): a última prevalece, etiquetas somam. */
function mergeDuplicates(rows: ImportRow[]): { rows: ImportRow[]; duplicadas: number } {
  const byPhone = new Map<string, ImportRow>()
  let duplicadas = 0
  for (const r of rows) {
    const prev = byPhone.get(r.phone)
    if (!prev) {
      byPhone.set(r.phone, r)
      continue
    }
    duplicadas++
    byPhone.set(r.phone, {
      ...r,
      line: prev.line,
      email: r.email ?? prev.email,
      tags: normalizeTags([...prev.tags, ...r.tags]),
    })
  }
  return { rows: Array.from(byPhone.values()), duplicadas }
}

export function parseImport(text: string, ddi: string = DEFAULT_DDI): ParsedImport {
  const records = parseCsv(text, detectDelimiter(text)).filter((r) => r.cells.some((c) => c.trim() !== ''))
  if (records.length === 0) return { ok: false, status: 400, message: 'O arquivo está vazio' }

  const cols = mapHeader(records[0].cells)
  if (cols.name === undefined || cols.phone === undefined) {
    return { ok: false, status: 400, message: 'A primeira linha precisa ter as colunas "nome" e "telefone"' }
  }
  const data = records.slice(1)
  if (data.length > MAX_IMPORT_ROWS) {
    return { ok: false, status: 413, message: `O arquivo passa do limite de ${MAX_IMPORT_ROWS} linhas` }
  }

  const rows: ImportRow[] = []
  const erros: ImportError[] = []
  for (const rec of data) {
    const result = buildRow(rec, cols, ddi)
    if ('erro' in result) erros.push(result.erro)
    else rows.push(result.row)
  }
  const merged = mergeDuplicates(rows)
  return { ok: true, rows: merged.rows, erros, ignorados: merged.duplicadas }
}
