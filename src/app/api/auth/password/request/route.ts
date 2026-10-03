import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sendPasswordResetEmail } from '@/server/mail/send-password-reset'
import { RESET_TTL_MS, clientIp, hashToken, newToken, resetIdentifier, tooMany } from '../_lib/shared'

export const runtime = 'nodejs'

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email() })

// Resposta sempre igual (200), exista a conta ou não, para não revelar quais e-mails estão cadastrados.
const GENERIC = { ok: true }

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Digite um e-mail válido.' }, { status: 400 })
  const { email } = parsed.data

  if (tooMany(`req:ip:${clientIp(req)}`, 10, 15 * 60_000) || tooMany(`req:mail:${email}`, 3, 15 * 60_000)) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente de novo em alguns minutos.' }, { status: 429 })
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return NextResponse.json(GENERIC)

  const identifier = resetIdentifier(email)
  const token = newToken()
  await db.$transaction([
    db.verificationToken.deleteMany({ where: { identifier } }), // invalida pedidos anteriores
    db.verificationToken.create({
      data: { identifier, token: hashToken(token), expires: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ])

  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || req.nextUrl.origin
  const link = `${base.replace(/\/$/, '')}/redefinir-senha?token=${encodeURIComponent(token)}`
  void sendPasswordResetEmail({ to: email, link })

  return NextResponse.json(GENERIC)
}
