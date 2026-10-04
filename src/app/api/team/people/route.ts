import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { normalizePapel } from '@/server/auth/permissions'
import { apiSession, unauthorized } from '@/server/settings/http'
import { ensureOrganization } from '@/server/spaces/org'
import { peopleWithAccess } from '@/server/team/access'

export const dynamic = 'force-dynamic'

// GET: pessoas com acesso ao espaço ATIVO (para o seletor de responsável da conversa). Todos os papéis.
export async function GET() {
  const deny = await denyUnless('conversations.use')
  if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const organizationId = s.organizationId ?? (await ensureOrganization(s.workspaceId))
  const people = await peopleWithAccess(s.workspaceId, organizationId)
  return NextResponse.json(
    people.map((p) => ({ id: p.id, nome: p.nome, fotoUrl: p.fotoUrl ?? p.image, papel: normalizePapel(p.papel), voce: p.id === s.userId })),
  )
}
