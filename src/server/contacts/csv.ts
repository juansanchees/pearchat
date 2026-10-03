// Parser e gerador de CSV próprios (sem dependências): aspas, CRLF, BOM, quebras dentro de aspas.

export type CsvRecord = { line: number; cells: string[] }

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Detecta ';' ou ',' pela primeira linha (fora de aspas). Empate -> ';' (padrão pt-BR). */
export function detectDelimiter(text: string): ',' | ';' {
  let commas = 0
  let semis = 0
  let inQuotes = false
  for (const ch of stripBom(text)) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break
    else if (!inQuotes && ch === ',') commas++
    else if (!inQuotes && ch === ';') semis++
  }
  return commas > semis ? ',' : ';'
}

/** Lê o CSV inteiro. `line` é a linha física (1 = primeira) onde o registro começa. */
export function parseCsv(input: string, delimiter: ',' | ';'): CsvRecord[] {
  const text = stripBom(input)
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let touched = false

  const endCell = () => {
    cells.push(cell)
    cell = ''
  }
  const endRecord = () => {
    endCell()
    records.push({ line: recordLine, cells })
    cells = []
    touched = false
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') {
      inQuotes = true
      touched = true
    } else if (ch === delimiter) {
      endCell()
      touched = true
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      if (touched || cell !== '') endRecord()
      line++
      recordLine = line
    } else {
      cell += ch
      touched = true
    }
  }
  if (touched || cell !== '') endRecord()
  return records
}

/** Prefixa ' em células que o Excel/Sheets interpretariam como fórmula. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function escapeCsvCell(value: string, delimiter = ';'): string {
  const safe = neutralizeFormula(value)
  return new RegExp(`["\\r\\n${delimiter}]`).test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Linhas -> texto CSV (CRLF), com BOM para o Excel abrir em UTF-8. */
export function buildCsv(rows: string[][], delimiter = ';'): string {
  const body = rows.map((r) => r.map((c) => escapeCsvCell(c, delimiter)).join(delimiter)).join('\r\n')
  return `﻿${body}\r\n`
}
