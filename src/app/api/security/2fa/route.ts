import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { invalidateActiveSpace } from '@/server/spaces/org'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { clientIpFromHeaders } from '@/server/security/hash'
import { MfaError, beginSetup, confirmSetup, disableMfa, mfaState, regenerateRecovery } from '@/server/security/mfa'
import { BLOCKED_MESSAGE, failureDelayMs, markSuccess, reserve, sleep } from '@/server/security/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'cache-control': 'no-store' }

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup') }),
  z.object({ action: z.literal('enable'), code: z.string().min(1).max(40) }),
  z.object({ action: z.literal('disable'), code: z.string().min(1).max(40), password: z.string().max(200).optional() }),
  z.object({ action: z.literal('recovery'), code: z.string().min(1).max(40) }),
])

export async function GET() {
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await mfaState(s.userId), { headers: noStore })
}

/** Ativar/desativar o 2FA e gerar códigos de recuperação. Quem adivinha códigos cai no mesmo limite do login. */
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, bodySchema)
  if ('error' in body) return body.error
  const input = body.data

  const user = await db.user.findUnique({ where: { id: s.userId }, select: { email: true } })
  if (!user) return unauthorized()
  const subject = { email: user.email, ip: clientIpFromHeaders(req.headers) }

  try {
    if (input.action === 'setup') {
      return NextResponse.json(await beginSetup(s.userId), { headers: noStore })
    }
    const res = await reserve('login', subject)
    if (res.blocked) return fail(BLOCKED_MESSAGE, 429)
    try {
      let out: unknown
      if (input.action === 'enable') out = { recoveryCodes: await confirmSetup(s.userId, input.code) }
      else if (input.action === 'recovery') out = { recoveryCodes: await regenerateRecovery(s.userId, input.code) }
      else {
        await disableMfa(s.userId, { password: input.password, code: input.code })
        invalidateActiveSpace(s.userId) // a versão de sessão subiu: a releitura não pode esperar o cache
        out = { ok: true }
      }
      await markSuccess('login', subject)
      return NextResponse.json(out, { headers: noStore })
    } catch (e) {
      if (e instanceof MfaError && e.status === 400) await sleep(failureDelayMs(res.failures))
      throw e
    }
  } catch (e) {
    if (e instanceof MfaError) return fail(e.message, e.status)
    throw e
  }
}
