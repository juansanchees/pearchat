import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { db } from '@/lib/db'
import { apiSession, fail, notFound, unauthorized } from '@/server/settings/http'
import { deleteTemplate, TemplateError } from '@/server/whatsapp/templates'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// Exclui o modelo (na Meta, se existir lá, e no PearChat).
export async function DELETE(_req: Request, { params }: Ctx) {
  const deny = await denyUnless('campaigns.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.id)) return notFound('Modelo')
  try {
    const t = await db.template.findFirst({ where: { id: params.id, workspaceId: s.workspaceId }, select: { id: true, metaId: true } })
    if (!t) return notFound('Modelo')
    if (!t.metaId) {
      // Só no PearChat: apaga direto, sem falar com a Meta.
      await db.template.delete({ where: { id: t.id } })
      return NextResponse.json({ ok: true })
    }
    return (await deleteTemplate(s.workspaceId, params.id)) ? NextResponse.json({ ok: true }) : notFound('Modelo')
  } catch (e) {
    if (e instanceof TemplateError) return fail(e.message, e.status)
    throw e
  }
}
