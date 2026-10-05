import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { readJson } from '@/server/http/body'
import { ANTECEDENCIAS, DIAS_A_FRENTE } from '@/server/booking/settings'
import type { BookingSettingsDto } from '@/server/booking/settings'
import { changeSlug, ensureSlug, generateSlugCandidate, validateSlug } from '@/server/booking/slug'

export const dynamic = 'force-dynamic'

const baseUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://pearchat.online').replace(/\/+$/, '')

async function load(workspaceId: string): Promise<BookingSettingsDto> {
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { nome: true, slug: true, bookingAtivo: true, bookingAntecedenciaMin: true, bookingDiasAFrente: true, bookingMensagem: true },
  })
  const base = baseUrl()
  return {
    ativo: w.bookingAtivo,
    slug: w.slug,
    url: w.slug ? `${base}/a/${w.slug}` : null,
    slugSugerido: generateSlugCandidate(w.nome, 1),
    base: `${base}/a/`,
    antecedenciaMin: w.bookingAntecedenciaMin,
    diasAFrente: w.bookingDiasAFrente,
    mensagem: w.bookingMensagem ?? '',
  }
}

/** GET /api/booking/settings -> BookingSettingsDto (sessão; só o espaço ativo). */
export async function GET() {
  const deny = await denyUnless('booking.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  return NextResponse.json(await load(workspaceId))
}

const bodySchema = z
  .object({
    ativo: z.boolean().optional(),
    slug: z.string().max(80).optional(),
    antecedenciaMin: z.number().refine((n) => (ANTECEDENCIAS as readonly number[]).includes(n), 'Antecedência inválida').optional(),
    diasAFrente: z.number().refine((n) => (DIAS_A_FRENTE as readonly number[]).includes(n), 'Período inválido').optional(),
    mensagem: z.string().max(200).nullable().optional(),
  })
  .strict()

/** PUT /api/booking/settings  { ativo?, slug?, antecedenciaMin?, diasAFrente?, mensagem? } -> BookingSettingsDto | 409 SLUG_EM_USO. */
export async function PUT(req: NextRequest) {
  const deny = await denyUnless('booking.manage'); if (deny) return deny
  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()
  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Dados do link inválidos')
  const b = parsed.data

  if (b.slug !== undefined) {
    const v = validateSlug(b.slug)
    if (!v.ok) return NextResponse.json({ error: v.message, code: 'SLUG_INVALIDO' }, { status: 400 })
    if ((await changeSlug(workspaceId, v.slug)) === 'EM_USO') {
      return NextResponse.json({ error: 'Esse endereço já está em uso. Escolha outro.', code: 'SLUG_EM_USO' }, { status: 409 })
    }
  }
  if (b.ativo === true) await ensureSlug(workspaceId)

  const mensagem = b.mensagem === undefined ? undefined : (b.mensagem?.replace(/\s+/g, ' ').trim() || null)
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(b.ativo !== undefined ? { bookingAtivo: b.ativo } : {}),
      ...(b.antecedenciaMin !== undefined ? { bookingAntecedenciaMin: b.antecedenciaMin } : {}),
      ...(b.diasAFrente !== undefined ? { bookingDiasAFrente: b.diasAFrente } : {}),
      ...(mensagem !== undefined ? { bookingMensagem: mensagem } : {}),
    },
  })
  return NextResponse.json(await load(workspaceId))
}
