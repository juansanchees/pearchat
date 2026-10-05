import { NextResponse } from 'next/server'
import { z } from 'zod'
import { denyIfEmailUnverified } from '@/server/auth/guard'
import { can, normalizePapel } from '@/server/auth/permissions'
import type { Action } from '@/server/auth/permissions'
import { isValidId } from '@/server/messages/api'
import { apiSession, notFound, unauthorized } from '@/server/settings/http'
import { ensureOrganization } from '@/server/spaces/org'
import { TeamError } from './service'
import type { Actor } from './service'

/** Sessão + permissão + organização garantida. Devolve o ator ou a resposta de erro pronta (401/403). */
export async function teamActor(action: Action): Promise<Actor | NextResponse> {
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!can(s, action)) return NextResponse.json({ error: 'Você não tem permissão para isso', code: 'SEM_PERMISSAO' }, { status: 403 })
  if (action === 'team.manage') {
    const unverified = await denyIfEmailUnverified(s.userId) // convidar pessoas exige e-mail confirmado
    if (unverified) return unverified
  }
  const organizationId = s.organizationId ?? (await ensureOrganization(s.workspaceId))
  return { userId: s.userId, organizationId, papel: normalizePapel(s.papel) }
}

export function teamErrorResponse(e: unknown): NextResponse {
  if (e instanceof TeamError) return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status })
  throw e
}

export const validTeamId = (id: string) => isValidId(id)
export const teamNotFound = () => notFound('Item')

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Digite um e-mail válido').max(200),
  papel: z.enum(['admin', 'agent'], { message: 'Escolha o papel' }),
  workspaceIds: z.array(z.string().min(1).max(64)).max(50).default([]),
})

export const memberPatchSchema = z
  .object({
    papel: z.enum(['owner', 'admin', 'agent']).optional(),
    workspaceIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine((v) => v.papel !== undefined || v.workspaceIds !== undefined, 'Nada para alterar')

export const resendSchema = z.object({ enviarEmail: z.boolean().optional() }).default({})
