import { NextResponse } from 'next/server'
import { unauthorizedResponse } from '@/server/auth/availability'
import { denyUnless } from '@/server/auth/guard'
import { z } from 'zod'
import { getApiSession } from '@/server/whatsapp/auth'
import { exchangeEmbeddedSignupCode } from '@/server/whatsapp/cloud-api'
import { connectConfig } from '@/server/whatsapp/config'
import { isGraphError } from '@/server/whatsapp/graph'
import { assertOficialAllowed, completeConnection, ConnectError, consumeSignupState } from '@/server/whatsapp/meta-connect'
import { readJson } from '@/server/http/body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  state: z.string().min(16).max(64),
  code: z.string().min(1).max(2000),
  wabaId: z.string().min(1).max(64).optional(),
  phoneNumberId: z.string().min(1).max(64).optional(),
  businessId: z.string().min(1).max(64).optional(),
  /** Evento WA_EMBEDDED_SIGNUP (FINISH, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING...). */
  event: z.string().max(80).optional(),
})

// Retorno do Cadastro incorporado pelo SDK (FB.login + evento WA_EMBEDDED_SIGNUP). Tudo que vem do navegador é validado:
// state de uso único, número pertencente à WABA do token e número não usado por outro workspace.
export async function POST(req: Request) {
  const deny = await denyUnless('wa.manage'); if (deny) return deny
  const session = await getApiSession()
  if (!session) return unauthorizedResponse()
  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  const { state, code, phoneNumberId, wabaId, businessId, event } = parsed.data
  const { workspaceId, userId } = session
  const cfg = connectConfig()
  if (cfg.demo || !cfg.metaConfigured) return NextResponse.json({ error: 'A conexão oficial estará disponível em breve.' }, { status: 409 })

  try {
    await assertOficialAllowed(userId)
    if (!(await consumeSignupState(state, workspaceId, userId))) {
      return NextResponse.json({ error: 'Esta tentativa expirou ou já foi usada. Comece de novo.' }, { status: 403 })
    }
    if (!wabaId) return NextResponse.json({ error: 'A Meta não informou a conta do WhatsApp. Tente de novo.' }, { status: 400 })
    let token: string
    try {
      token = await exchangeEmbeddedSignupCode(code)
    } catch (e) {
      if (isGraphError(e) && e.status >= 400 && e.status < 500) {
        console.error(`[wa/embedded-signup] code recusado (${e.toLog()})`)
        return NextResponse.json({ error: 'A Meta recusou o código (inválido ou expirado). Comece de novo.' }, { status: 400 })
      }
      throw e
    }
    const dto = await completeConnection({
      workspaceId,
      token,
      wabaId,
      phoneNumberId,
      businessId,
      coexistence: event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    })
    return NextResponse.json(dto)
  } catch (e) {
    if (e instanceof ConnectError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[wa/embedded-signup]', isGraphError(e) ? e.toLog() : e instanceof Error ? e.message : 'erro')
    return NextResponse.json({ error: 'Não foi possível concluir a conexão com a Meta' }, { status: 502 })
  }
}
