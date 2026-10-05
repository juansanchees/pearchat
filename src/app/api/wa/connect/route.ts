import { NextResponse } from 'next/server'
import { unauthorizedResponse } from '@/server/auth/availability'
import { denyUnless } from '@/server/auth/guard'
import { z } from 'zod'
import { getApiSession } from '@/server/whatsapp/auth'
import { connectConfig } from '@/server/whatsapp/config'
import { getProvider, WhatsAppProviderError } from '@/server/whatsapp'
import { instanceNameFor } from '@/server/whatsapp/evolution'
import { assertOficialAllowed, ConnectError } from '@/server/whatsapp/meta-connect'
import { onlyDigits } from '@/server/whatsapp/phone'
import { setStatus, toStatusDTO } from '@/server/whatsapp/session'
import { readJson } from '@/server/http/body'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  provider: z.enum(['oficial', 'rapida']),
  numero: z.string().max(40).optional(),
})

export async function POST(req: Request) {
  const deny = await denyUnless('wa.manage'); if (deny) return deny
  const session = await getApiSession()
  if (!session) return unauthorizedResponse()

  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  const { provider, numero } = parsed.data
  const { workspaceId } = session

  // Oficial só existe de verdade com a Meta configurada (ou no demo, que simula): sem isso, nada de fluxo falso.
  if (provider === 'oficial') {
    const cfg = connectConfig()
    if (!cfg.demo && !cfg.metaConfigured) {
      return NextResponse.json({ error: 'A conexão oficial estará disponível em breve. Use a conexão rápida por QR.' }, { status: 409 })
    }
    // Beta fechado: fora do modo demo só e-mails da lista de teste (META_OFICIAL_BETA_EMAILS) conectam a API oficial.
    if (!cfg.demo) {
      try {
        await assertOficialAllowed(session.userId)
      } catch (e) {
        if (e instanceof ConnectError) return NextResponse.json({ error: e.message }, { status: e.status })
        throw e
      }
    }
  }

  if (provider === 'oficial' && connectConfig().demo && (!numero || onlyDigits(numero).length < 10)) {
    return NextResponse.json({ error: 'Digite o número com DDD' }, { status: 400 })
  }

  try {
    const result = await getProvider(provider).connect(workspaceId)
    const row = await setStatus(workspaceId, 'aguardando_qr', {
      provider,
      numero: provider === 'oficial' ? (numero?.trim() ?? null) : null,
      qr: result.qr ?? null,
      ...(provider === 'rapida' ? { evolutionInstance: instanceNameFor(workspaceId) } : {}),
    })
    return NextResponse.json(toStatusDTO(row, result.qr))
  } catch (e) {
    const detail = e instanceof WhatsAppProviderError ? `${e.message}` : 'Falha ao iniciar a conexão'
    console.error('[wa/connect]', detail)
    return NextResponse.json({ error: 'Não foi possível iniciar a conexão com o WhatsApp' }, { status: 502 })
  }
}
