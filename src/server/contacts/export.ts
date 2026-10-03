import { db } from '@/lib/db'
import { buildCsv } from './csv'
import type { ContactRow } from './serialize'
import { contactInclude } from './serialize'

export const EXPORT_HEADER = [
  'Nome',
  'Telefone',
  'E-mail',
  'Etiquetas',
  'Endereço',
  'Aniversário',
  'Pedidos',
  'Total gasto',
  'Cliente desde',
  'Notas',
]

const dayMonth = (d: Date | null) =>
  d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` : ''

const dateBR = (d: Date | null) =>
  d
    ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    : ''

export function contactToCsvRow(c: ContactRow): string[] {
  return [
    c.nome,
    c.telefone ?? '',
    c.email ?? '',
    c.tags.join(', '),
    c.endereco ?? '',
    dayMonth(c.aniversario),
    String(c.pedidos),
    c.totalGasto.toNumber().toFixed(2).replace('.', ','),
    dateBR(c.clienteDesde),
    c.notas ?? '',
  ]
}

export function filenameForToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `contatos-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`
}

export async function exportContactsCsv(workspaceId: string): Promise<string> {
  const rows = await db.contact.findMany({
    where: { workspaceId },
    include: contactInclude,
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  })
  return buildCsv([EXPORT_HEADER, ...rows.map(contactToCsvRow)])
}
