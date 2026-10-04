import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { denyUnless } from '@/server/auth/guard'
import { badRequest, readJson, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import {
  DEFAULT_LEMBRETES,
  apiError,
  getConnection,
  isRealConnection,
  toCalendarState,
} from '@/server/calendar/service'

export const dynamic = 'force-dynamic'

const bodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    calendarios: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          nome: z.string().trim().min(1).max(200),
          selecionado: z.boolean(),
        }),
      )
      .min(1)
      .max(50),
    destinoId: z.string().min(1),
  })
  .strict()

/**
 * PUT|POST /api/calendar/connect-demo  { email, calendarios: [{id,nome,selecionado}], destinoId }
 * Fluxo simulado: grava CalendarConnection com provider 'google-demo' e tokens null (nenhuma
 * chamada ao Google). A agenda-destino é forçada a selecionada. Se já existir conexão demo,
 * mantém as preferências (IA, duração, lembretes); senão aplica os padrões da spec
 * (IA ligada, 60 min, ['24h','2h']). 200 CalendarStateDto | 400 | 401 | 409 CONEXAO_REAL_ATIVA
 * (desconecte antes de simular).
 */
async function connectDemo(req: NextRequest) {
  const deny = await denyUnless('calendar.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const json = await readJson(req)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return badRequest('Dados da conexão inválidos')
  const { email, destinoId } = parsed.data
  if (!parsed.data.calendarios.some((c) => c.id === destinoId)) {
    return badRequest('Agenda de destino deve estar na lista de agendas')
  }
  const calendarios = parsed.data.calendarios.map((c) =>
    c.id === destinoId ? { ...c, selecionado: true } : c,
  )

  const existing = await getConnection(workspaceId)
  if (isRealConnection(existing)) {
    return apiError('CONEXAO_REAL_ATIVA', 'Desconecte o Google Agenda antes de usar a demonstração.', 409)
  }

  const row = await db.calendarConnection.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      provider: 'google-demo',
      email,
      tokens: null,
      calendarios,
      destinoId,
      iaPodeAgendar: true,
      duracaoPadraoMin: 60,
      lembretes: DEFAULT_LEMBRETES,
    },
    update: { provider: 'google-demo', email, tokens: null, calendarios, destinoId },
  })
  return NextResponse.json(toCalendarState(row))
}

export const PUT = connectDemo
export const POST = connectDemo
