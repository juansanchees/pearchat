import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { normalizePhone } from '@/server/contacts/phone'
import { getWorkspaceDdi } from '@/server/workspace-locale'
import { MEDIA_LABEL } from '@/server/media/mime'
import { ingestInboundMessage } from '@/server/messages/ingest'
import { registerMockMedia } from '@/server/whatsapp/mock'
import { readJson } from '@/server/http/body'

export const dynamic = 'force-dynamic'

const mediaSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'document', 'sticker']),
  mime: z.string().max(120).optional(),
  name: z.string().max(200).optional(),
  durationSec: z.number().int().min(0).max(100_000).optional(),
  /** Conteúdo do arquivo "no celular do cliente" (base64). O PearChat o baixa pelo provedor de mentira, como faria com a Evolution. */
  base64: z.string().max(40_000_000),
  /** Quantas vezes o primeiro downloads falha antes de dar certo (teste de erro e "Tentar de novo"). */
  failTimes: z.number().int().min(0).max(20).optional(),
  /** Tamanho que o WhatsApp "anuncia" (padrão: o tamanho real). */
  size: z.number().int().min(0).max(2_000_000_000).optional(),
  /** Só registra o arquivo no provedor de mentira, sem criar mensagem. Devolve o providerMessageId. */
  fixtureOnly: z.boolean().optional(),
})

const schema = z.object({
  telefone: z.string().trim().min(8).max(24).optional(),
  /** LID do WhatsApp (só dígitos): simula o evento em que a Evolution entrega o LID e o telefone juntos. */
  waUserId: z.string().trim().regex(/^\d{5,24}$/).optional(),
  nome: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().max(4096).optional(),
  media: mediaSchema.optional(),
})

// Simula um cliente escrevendo (ou mandando mídia). Só existe com WA_MOCK=true.
export async function POST(req: Request) {
  if (process.env.WA_MOCK !== 'true') return new NextResponse(null, { status: 404 })

  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const parsed = schema.safeParse(await readJson(req))
  if (!parsed.success) return badRequest('Corpo inválido')
  if (!parsed.data.body && !parsed.data.media) return badRequest('Corpo inválido')

  // Mesmo formato E.164 que a produção usa (DDI padrão do espaço quando o número vem sem DDI).
  const telefone = parsed.data.telefone ? normalizePhone(parsed.data.telefone, await getWorkspaceDdi(workspaceId)) : undefined
  if (parsed.data.telefone && !telefone) return badRequest('Telefone inválido')
  const waUserId = parsed.data.waUserId
  if (!telefone && !waUserId) return badRequest('Corpo inválido')
  const from = { ...(telefone ? { telefone } : {}), ...(waUserId ? { waUserId } : {}) }

  const providerMessageId = `mock-${randomUUID()}`
  const media = parsed.data.media
  if (media) {
    const data = Buffer.from(media.base64, 'base64')
    registerMockMedia(providerMessageId, { data, mime: media.mime, fileName: media.name, failTimes: media.failTimes ?? 0 })
    if (media.fixtureOnly) return NextResponse.json({ ok: true, providerMessageId }, { status: 201 })
    await ingestInboundMessage({
      workspaceId,
      from,
      nome: parsed.data.nome,
      body: parsed.data.body || MEDIA_LABEL[media.type],
      media: {
        type: media.type,
        ...(media.mime ? { mime: media.mime } : {}),
        size: media.size ?? data.length,
        ...(media.name ? { name: media.name } : {}),
        ...(media.durationSec !== undefined ? { durationSec: media.durationSec } : {}),
        ...(parsed.data.body ? { caption: parsed.data.body } : {}),
      },
      providerMessageId,
      timestamp: new Date(),
    })
    return NextResponse.json({ ok: true, providerMessageId }, { status: 201 })
  }

  await ingestInboundMessage({
    workspaceId,
    from,
    nome: parsed.data.nome,
    body: parsed.data.body ?? '',
    providerMessageId,
    timestamp: new Date(),
  })
  return NextResponse.json({ ok: true, providerMessageId }, { status: 201 })
}
