import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CampaignError, createTemplate, listTemplates, templateSchema, toTemplateDTO } from '@/server/campaigns/service'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { submitTemplate, syncTemplates, TemplateError } from '@/server/whatsapp/templates'
import { logError } from '@/server/engine/util'

export const dynamic = 'force-dynamic'

/** Conexão oficial real (não o demo) em uso neste workspace. */
async function isOficial(workspaceId: string): Promise<boolean> {
  if (process.env.WA_MOCK === 'true') return false
  const s = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { provider: true, status: true } })
  return s?.provider === 'OFICIAL' && s.status !== 'DESCONECTADO'
}

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  // Conexão oficial: traz o status real da Meta antes de listar (no máx. 1 vez por minuto; falha não impede a lista).
  if (await isOficial(s.workspaceId)) {
    await syncTemplates(s.workspaceId).catch((e) => logError('templates', 'sincronização ao abrir falhou', e))
  }
  return NextResponse.json(await listTemplates(s.workspaceId))
}

// Conexão oficial: cria o modelo NA META (ou envia para aprovação um "Só no PearChat"). Conexão rápida: modelo local, como antes.
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, templateSchema)
  if ('error' in body) return body.error
  try {
    if (await isOficial(s.workspaceId)) {
      const t = await submitTemplate(s.workspaceId, {
        id: body.data.id,
        name: body.data.name,
        category: body.data.category,
        body: body.data.body,
        examples: body.data.examples,
      })
      return NextResponse.json(toTemplateDTO(t), { status: 201 })
    }
    return NextResponse.json(await createTemplate(s.workspaceId, body.data), { status: 201 })
  } catch (e) {
    if (e instanceof CampaignError) return fail(e.message, e.status)
    if (e instanceof TemplateError) return fail(e.message, e.status)
    throw e
  }
}
