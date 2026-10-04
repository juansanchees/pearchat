import { NextResponse } from 'next/server'
import { apiSession, fail } from '@/server/settings/http'
import { isValidId } from '@/server/messages/api'
import { ensureOrganization } from './org'
import { SpaceError } from './service'

export type OrgSession = { userId: string; workspaceId: string; organizationId: string; papel: string }

/** Sessão + organização garantida (cria sob demanda para contas anteriores à migração). null = 401. */
export async function orgSession(): Promise<OrgSession | null> {
  const s = await apiSession()
  if (!s) return null
  const organizationId = s.organizationId ?? (await ensureOrganization(s.workspaceId))
  return { userId: s.userId, workspaceId: s.workspaceId, organizationId, papel: s.papel }
}

/** Id de espaço vindo da URL: qualquer coisa fora do formato de id é "não encontrado". */
export const validSpaceId = (id: string) => isValidId(id)

export function spaceErrorResponse(e: unknown): NextResponse {
  if (e instanceof SpaceError) {
    const res = fail(e.message, e.status)
    if (e.code) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    return res
  }
  throw e
}
