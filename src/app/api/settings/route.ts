import { NextResponse } from 'next/server'
import { can } from '@/server/auth/permissions'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { getSettings, SettingsError, settingsSchema, updateSettings } from '@/server/settings/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getSettings(s.userId, s.workspaceId))
}

export async function PUT(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, settingsSchema)
  if ('error' in body) return body.error
  try {
    let input = body.data
    if (!can(s, 'settings.workspace')) {
      // Equipe: atendente salva só o PRÓPRIO perfil (nome, e-mail, avisos); nome do negócio e horário ficam como estão.
      const cur = await getSettings(s.userId, s.workspaceId)
      input = { ...input, empresa: cur.empresa, horarioAtendimento: cur.horarioAtendimento }
    }
    return NextResponse.json(await updateSettings(s.userId, s.workspaceId, input))
  } catch (e) {
    if (e instanceof SettingsError) return fail(e.message, e.status)
    throw e
  }
}
