import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiSession, unauthorized } from '@/server/settings/http'
import { MAX_ATTEMPTS, verifyEmailCode } from '@/server/mail/email-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ code: z.string().regex(/^\d{6}$/) })

/** Confere o código de 6 dígitos da conta logada (no máximo 5 tentativas por código). */
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Digite os 6 dígitos.', code: 'invalid' }, { status: 400 })

  const user = await db.user.findUnique({ where: { id: s.userId }, select: { id: true, email: true, nome: true, emailVerified: true } })
  if (!user) return unauthorized()
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true })

  const r = await verifyEmailCode(user, parsed.data.code)
  if (r.ok) return NextResponse.json({ ok: true })
  if (r.reason === 'incorrect') {
    return NextResponse.json(
      { error: 'Código incorreto. Confira e tente de novo.', code: 'incorrect', remaining: r.remaining, max: MAX_ATTEMPTS },
      { status: 400 },
    )
  }
  if (r.reason === 'locked') {
    return NextResponse.json({ error: 'Muitas tentativas. Peça um código novo.', code: 'locked' }, { status: 429 })
  }
  return NextResponse.json({ error: 'Este código expirou. Peça um novo.', code: 'expired' }, { status: 400 })
}
