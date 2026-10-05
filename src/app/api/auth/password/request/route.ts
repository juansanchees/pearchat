import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sendMail } from '@/server/mail/send'
import { passwordResetEmail } from '@/server/mail/templates'
import { BLOCKED_MESSAGE, consume } from '@/server/security/rate-limit'
import { RESET_TTL_MS, clientIp, hashToken, newToken, resetIdentifier } from '../_lib/shared'
import { readJsonLimited, SMALL_LIMIT_BYTES, TOO_LARGE_MESSAGE } from '@/server/http/body'

export const runtime = 'nodejs'

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email() })

// Resposta sempre igual (200), exista a conta ou não, para não revelar quais e-mails estão cadastrados.
const GENERIC = { ok: true }

export async function POST(req: NextRequest) {
  const raw = await readJsonLimited(req, SMALL_LIMIT_BYTES)
  if (!raw.ok && raw.status === 413) return NextResponse.json({ error: TOO_LARGE_MESSAGE }, { status: 413 })
  const parsed = bodySchema.safeParse(raw.ok ? raw.body : null)
  if (!parsed.success) return NextResponse.json({ error: 'Digite um e-mail válido.' }, { status: 400 })
  const { email } = parsed.data

  // Cada pedido conta (exista a conta ou não): 3 por e-mail e 10 por IP a cada 15 min.
  if ((await consume('resetRequest', { email, ip: clientIp(req) })).blocked) {
    return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 429 })
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
  void sendMail({ to: email, ...passwordResetEmail({ link }) })

  return NextResponse.json(GENERIC)
}
