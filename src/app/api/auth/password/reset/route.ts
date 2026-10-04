import bcrypt from 'bcryptjs'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { BLOCKED_MESSAGE, consume } from '@/server/security/rate-limit'
import { RESET_PREFIX, clientIp, hashToken } from '../_lib/shared'

export const runtime = 'nodejs'

const bodySchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.').max(200),
})

const INVALID = { error: 'Este link é inválido ou expirou. Peça um novo.' }

export async function POST(req: NextRequest) {
  if ((await consume('resetConfirm', { ip: clientIp(req) })).blocked) {
    return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 429 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const msg = parsed.error.issues.find((i) => i.path[0] === 'password')?.message
    return NextResponse.json(msg ? { error: msg } : INVALID, { status: 400 })
  }
  const { token, password } = parsed.data

  const row = await db.verificationToken.findFirst({
    where: { token: hashToken(token), identifier: { startsWith: RESET_PREFIX } },
  })
  if (!row || row.expires.getTime() < Date.now()) {
    if (row) await db.verificationToken.deleteMany({ where: { identifier: row.identifier } })
    return NextResponse.json(INVALID, { status: 400 })
  }

  // Uso único: só segue quem de fato consumiu o token.
  const consumed = await db.verificationToken.deleteMany({
    where: { identifier: row.identifier, token: row.token },
  })
  if (consumed.count !== 1) return NextResponse.json(INVALID, { status: 400 })

  const email = row.identifier.slice(RESET_PREFIX.length)
  const passwordHash = await bcrypt.hash(password, 10)
  const updated = await db.user.updateMany({ where: { email }, data: { passwordHash, sessionVersion: { increment: 1 } } })
  if (updated.count === 0) return NextResponse.json(INVALID, { status: 400 })

  await db.verificationToken.deleteMany({ where: { identifier: row.identifier } })
  return NextResponse.json({ ok: true })
}
