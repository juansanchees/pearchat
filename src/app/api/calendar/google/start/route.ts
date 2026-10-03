import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { apiError, logGoogleFailure } from '@/server/calendar/service'
import { appBaseUrl, buildAuthUrl, createState, googleConfigured } from '@/server/calendar/google'

export const dynamic = 'force-dynamic'

/**
 * GET /api/calendar/google/start -> 302 para o consentimento OAuth2 do Google
 * (access_type=offline, prompt=consent, state com nonce de uso único válido por 10 min).
 * 401 sem sessão | 501 { error: 'GOOGLE_NAO_CONFIGURADO' } sem GOOGLE_CLIENT_ID/SECRET |
 * 500 ERRO_INTERNO (ex.: AUTH_SECRET ausente).
 */
export async function GET(req: NextRequest) {
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  if (!googleConfigured()) {
    return apiError('GOOGLE_NAO_CONFIGURADO', 'A integração com o Google Agenda não está configurada.', 501)
  }
  try {
    const url = buildAuthUrl(await createState(workspaceId), appBaseUrl(req.nextUrl.origin))
    return NextResponse.redirect(url, 302)
  } catch (err) {
    logGoogleFailure('start', err)
    return apiError('ERRO_INTERNO', 'Não foi possível iniciar a conexão com o Google.', 500)
  }
}
