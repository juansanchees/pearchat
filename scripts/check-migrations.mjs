// Regra das migrações: a migração N só pode ADICIONAR (tabela, coluna anulável ou com DEFAULT, índice).
// Apagar, renomear, tornar obrigatório ou alterar tipo só na migração N+1, depois que o código N já não usa o item.
// Motivo: voltar o app para a versão anterior (deploy/rollback.sh) NÃO desfaz migrações; o código antigo precisa continuar
// funcionando com o banco novo. Veja docs/operacao/publicacao.md.
//
// Uso: node scripts/check-migrations.mjs        (roda no CI; sai com código 1 se achar algo)
// Só confere migrações NOVAS (número maior que BASELINE: as anteriores já estão em produção). Para aprovar de propósito
// uma migração que contrai o banco, coloque no arquivo a linha:   -- contrair: aprovado (explique por quê)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASELINE = Number(process.env.MIGRATIONS_BASELINE ?? 19) // 0001..0019 já estão em produção
const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'prisma', 'migrations')

const PATTERNS = [
  [/\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA|INDEX|CONSTRAINT|VIEW)\b/i, 'DROP (apagar tabela/coluna/tipo/índice/restrição)'],
  [/\bRENAME\b/i, 'RENAME (renomear)'],
  [/\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i, 'SET NOT NULL (coluna passa a ser obrigatória)'],
  [/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, 'ALTER COLUMN ... TYPE (mudar o tipo)'],
  [/\bALTER\s+TYPE\b[^;]*\b(DROP|RENAME)\b/i, 'ALTER TYPE (remover/renomear valor)'],
  [/\bADD\s+COLUMN\b[^;,]*\bNOT\s+NULL\b(?![^;,]*\bDEFAULT\b)/i, 'ADD COLUMN ... NOT NULL sem DEFAULT (o código antigo não preenche)'],
  [/\bTRUNCATE\b|\bDELETE\s+FROM\b/i, 'TRUNCATE / DELETE FROM (apagar dados)'],
]

if (!existsSync(dir)) {
  console.log(`check-migrations: pasta ${dir} não existe; nada a conferir.`)
  process.exit(0)
}
let problems = 0
let checked = 0
for (const name of readdirSync(dir).sort()) {
  const n = Number(name.match(/^(\d+)_/)?.[1])
  if (!Number.isFinite(n) || n <= BASELINE) continue
  const f = join(dir, name, 'migration.sql')
  if (!existsSync(f)) continue
  checked++
  const sql = readFileSync(f, 'utf8')
  if (/--\s*contrair:\s*aprovado/i.test(sql)) {
    console.log(`  aprovada de propósito: ${name}`)
    continue
  }
  // ignora comentários de linha para não acusar texto de explicação
  const code = sql.replace(/--[^\n]*/g, '')
  for (const [re, label] of PATTERNS) {
    if (re.test(code)) {
      console.error(`ERRO: ${name}: ${label}`)
      problems++
    }
  }
}
if (problems) {
  console.error(`\ncheck-migrations: ${problems} problema(s). Migrações só podem ADICIONAR. Se for intencional (versão seguinte, código antigo já não usa o item), acrescente a linha "-- contrair: aprovado" ao arquivo.`)
  process.exit(1)
}
console.log(`check-migrations: OK (${checked} migração(ões) nova(s) conferida(s); baseline ${BASELINE}).`)
