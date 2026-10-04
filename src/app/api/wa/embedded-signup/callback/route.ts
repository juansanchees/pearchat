import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { z } from 'zod'
import { getApiSession } from '@/server/whatsapp/auth'
import { db } from '@/lib/db'
import { exchangeEmbeddedSignupCode, fetchDisplayPhone, phoneBelongsToWaba, subscribeApp } from '@/server/whatsapp/cloud-api'
import { getSession, mergeSessionData, setStatus, toStatusDTO } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  code: z.string().min(1).max(2000),
  phoneNumberId: z.string().min(1).max(64),
  wabaId: z.string().min(1).max(64),
})

export async function POST(req: Request) {
  const deny = await denyUnless('wa.manage'); if (deny) return deny
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  const { code, phoneNumberId, wabaId } = parsed.data
  const { workspaceId } = session

  try {
    const token = await exchangeEmbeddedSignupCode(code)
    // phoneNumberId/wabaId vêm do navegador: só vale se o número pertence à WABA do token e não é de outro workspace.
    if (!(await phoneBelongsToWaba(wabaId, phoneNumberId, token))) {
      return NextResponse.json({ error: 'Número não pertence à conta informada' }, { status: 403 })
    }
    const taken = await db.whatsAppSession.findFirst({
      where: { metaPhoneNumberId: phoneNumberId, workspaceId: { not: workspaceId } },
      select: { id: true },
    })
    if (taken) return NextResponse.json({ error: 'Esse número já está conectado a outro workspace' }, { status: 409 })
    await subscribeApp(wabaId, token)
    const current = await getSession(workspaceId)
    const display = await fetchDisplayPhone(phoneNumberId, token)
    // O token só é gravado criptografado (exige ENCRYPTION_KEY).
    const sessionData = await mergeSessionData(workspaceId, { accessToken: token })
    const row = await setStatus(workspaceId, 'conectado', {
      provider: 'oficial',
      numero: display ?? current?.numero ?? null,
      metaPhoneNumberId: phoneNumberId,
      metaWabaId: wabaId,
      sessionData,
    })
    return NextResponse.json(toStatusDTO(row))
  } catch (e) {
    console.error('[wa/embedded-signup]', e instanceof Error ? e.message : 'erro')
    return NextResponse.json({ error: 'Não foi possível concluir a conexão com a Meta' }, { status: 502 })
  }
}
