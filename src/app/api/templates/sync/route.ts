import { NextResponse } from 'next/server'
import { listTemplates } from '@/server/campaigns/service'
import { apiSession, fail, unauthorized } from '@/server/settings/http'
import { syncTemplates, TemplateError } from '@/server/whatsapp/templates'

export const dynamic = 'force-dynamic'

// "Atualizar status": sincroniza agora com a Meta (ignora o intervalo mínimo de 1 minuto da abertura do painel).
export async function POST() {
  const s = await apiSession()
  if (!s) return unauthorized()
  try {
    await syncTemplates(s.workspaceId, { force: true })
    return NextResponse.json(await listTemplates(s.workspaceId))
  } catch (e) {
    if (e instanceof TemplateError) return fail(e.message, e.status)
    throw e
  }
}
