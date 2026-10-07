import { db } from '@/lib/db'
import { DEFAULT_DDI, isValidDdi } from '@/lib/phone'
import { DEFAULT_TZ, normTz } from '@/lib/timezone'

// DDI padrão e fuso horário do espaço (Workspace.ddiPadrao / Workspace.timezone). Lidos com um cache curto em memória
// (compartilhado entre os módulos do mesmo processo): o motor consulta isto a cada passada, e a mudança vale em até 30 s
// nos outros processos (na hora, no que gravou: `invalidateWorkspaceLocale`).

export type WorkspaceLocale = { ddiPadrao: string; timezone: string }

export const DEFAULT_LOCALE: WorkspaceLocale = { ddiPadrao: DEFAULT_DDI, timezone: DEFAULT_TZ }

const TTL_MS = 30_000
type Entry = { at: number; v: WorkspaceLocale }
const holder = globalThis as unknown as { __pearchat_wslocale?: Map<string, Entry> }
const cache = (holder.__pearchat_wslocale ??= new Map<string, Entry>())

/** Normaliza o que veio do banco (nunca devolve um fuso/DDI inválido). */
export function toLocale(row: { ddiPadrao?: string | null; timezone?: string | null } | null | undefined): WorkspaceLocale {
  const ddi = row?.ddiPadrao ?? ''
  return { ddiPadrao: isValidDdi(ddi) ? ddi : DEFAULT_DDI, timezone: normTz(row?.timezone) }
}

export async function getWorkspaceLocale(workspaceId: string): Promise<WorkspaceLocale> {
  const hit = cache.get(workspaceId)
  const now = Date.now()
  if (hit && now - hit.at < TTL_MS) return hit.v
  const row = await db.workspace.findUnique({ where: { id: workspaceId }, select: { ddiPadrao: true, timezone: true } })
  const v = row ? toLocale(row) : DEFAULT_LOCALE
  if (cache.size > 2000) cache.clear()
  cache.set(workspaceId, { at: now, v })
  return v
}

export const getWorkspaceTz = async (workspaceId: string): Promise<string> => (await getWorkspaceLocale(workspaceId)).timezone
export const getWorkspaceDdi = async (workspaceId: string): Promise<string> => (await getWorkspaceLocale(workspaceId)).ddiPadrao

export function invalidateWorkspaceLocale(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId)
  else cache.clear()
}
