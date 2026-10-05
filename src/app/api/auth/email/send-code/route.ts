import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiSession, unauthorized } from '@/server/settings/http'
import { issueEmailCode } from '@/server/mail/email-verification'
import { mailConfigured } from '@/server/mail/send'
import { BLOCKED_MESSAGE, consume } from '@/server/security/rate-limit'
import { clientIpFromHeaders } from '@/server/security/hash'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Envia (ou reenvia) o código de 6 dígitos ao e-mail da conta logada. Limites: 1 a cada 60 s e 5 por hora. */
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!mailConfigured()) return NextResponse.json({ error: 'O envio de e-mail não está disponível.' }, { status: 503 })
  // Além do limite por conta (60 s / 5 por hora), um teto por IP: várias contas novas não viram canhão de e-mail.
  if ((await consume('emailSend', { ip: clientIpFromHeaders(req.headers) })).blocked) return NextResponse.json({ error: BLOCKED_MESSAGE, code: 'rate_limited' }, { status: 429 })

  const user = await db.user.findUnique({ where: { id: s.userId }, select: { id: true, email: true, nome: true, emailVerified: true } })
  if (!user) return unauthorized()
  if (user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true })

  const r = await issueEmailCode(user)
  if (!r.ok) {
    const error =
      r.reason === 'hourly'
        ? 'Você pediu códigos demais. Tente de novo mais tarde.'
        : `Aguarde ${r.retryAfter}s para pedir outro código.`
    return NextResponse.json({ error, code: r.reason, retryAfter: r.retryAfter }, { status: 429 })
  }
  if (!r.sent) {
    return NextResponse.json(
      { error: 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.', code: 'send_failed', retryAfter: r.retryAfter },
      { status: 502 },
    )
  }
  return NextResponse.json({ ok: true, retryAfter: r.retryAfter })
}
