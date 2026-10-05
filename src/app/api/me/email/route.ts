import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cancelEmailChange, confirmEmailChange, emailChangeState, EmailChangeError, requestEmailChange } from '@/server/mail/email-change'
import { clientIpFromHeaders } from '@/server/security/hash'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'cache-control': 'no-store' }

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request'),
    email: z.string().trim().toLowerCase().email('Digite um e-mail válido.').max(200),
    password: z.string().min(1, 'Digite sua senha.').max(200),
    code2fa: z.string().max(40).optional(),
  }),
  z.object({ action: z.literal('confirm'), code: z.string().regex(/^\d{6}$/, 'Digite os 6 dígitos.') }),
  z.object({ action: z.literal('cancel') }),
])

/** Estado da troca de e-mail (disponível? tem senha? 2FA? pedido pendente?). */
export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await emailChangeState(s.userId), { headers: noStore })
}

/**
 * Troca do e-mail de login em duas etapas (o PUT /api/settings NÃO troca mais o e-mail):
 *  - request: senha atual (+ código do 2FA, se ativo) e o e-mail novo; um código de 6 dígitos vai para o ENDEREÇO NOVO
 *    e um aviso para o antigo. Indisponível (503) sem serviço de e-mail.
 *  - confirm: o código do endereço novo; troca o e-mail, derruba TODAS as sessões (a tela sai em seguida) e avisa o antigo.
 *  - cancel: descarta o pedido pendente.
 */
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, bodySchema, 4 * 1024)
  if ('error' in body) return body.error
  const input = body.data
  const ip = clientIpFromHeaders(req.headers)
  try {
    if (input.action === 'request') {
      const r = await requestEmailChange(s.userId, { novoEmail: input.email, password: input.password, code2fa: input.code2fa }, ip)
      return NextResponse.json({ ok: true, retryAfter: r.retryAfter }, { headers: noStore })
    }
    if (input.action === 'confirm') {
      const r = await confirmEmailChange(s.userId, input.code, ip)
      return NextResponse.json({ ok: true, email: r.email, sessoesEncerradas: true }, { headers: noStore })
    }
    await cancelEmailChange(s.userId)
    return NextResponse.json({ ok: true }, { headers: noStore })
  } catch (e) {
    if (e instanceof EmailChangeError) {
      const res = fail(e.message, e.status)
      if (e.retryAfter) res.headers.set('Retry-After', String(e.retryAfter))
      return res
    }
    throw e
  }
}
