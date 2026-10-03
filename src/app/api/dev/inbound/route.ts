import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { badRequest, sessionWorkspaceId, unauthorized } from '@/server/messages/api'
import { ingestInboundMessage } from '@/server/messages/ingest'

export const dynamic = 'force-dynamic'

const schema = z.object({
  telefone: z.string().trim().min(8).max(24),
  nome: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(4096),
})

// Simula um cliente escrevendo. Só existe com WA_MOCK=true.
export async function POST(req: Request) {
  if (process.env.WA_MOCK !== 'true') return new NextResponse(null, { status: 404 })

  const workspaceId = await sessionWorkspaceId()
  if (!workspaceId) return unauthorized()

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest('Corpo inválido')

  const digits = parsed.data.telefone.replace(/\D/g, '')
  if (digits.length < 8) return badRequest('Telefone inválido')

  await ingestInboundMessage({
    workspaceId,
    from: { telefone: `+${digits}` },
    nome: parsed.data.nome,
    body: parsed.data.body,
    providerMessageId: `mock-${randomUUID()}`,
    timestamp: new Date(),
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
