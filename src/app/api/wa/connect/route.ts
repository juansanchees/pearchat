import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiSession } from '@/server/whatsapp/auth'
import { getProvider, WhatsAppProviderError } from '@/server/whatsapp'
import { instanceNameFor } from '@/server/whatsapp/evolution'
import { onlyDigits } from '@/server/whatsapp/phone'
import { setStatus, toStatusDTO } from '@/server/whatsapp/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  provider: z.enum(['oficial', 'rapida']),
  numero: z.string().max(40).optional(),
})

export async function POST(req: Request) {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  const { provider, numero } = parsed.data
  const { workspaceId } = session

  if (provider === 'oficial' && (!numero || onlyDigits(numero).length < 10)) {
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
