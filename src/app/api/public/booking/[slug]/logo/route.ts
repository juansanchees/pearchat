import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { throttled } from '@/server/booking/http'
import { getPublicWorkspace } from '@/server/booking/public'
import { avatarMime, logoIdFromUrl, openLogo } from '@/server/media/avatars'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

// Logo na página pública de agendamento. Sem login, mas SÓ por slug de link ativo (o id do espaço nunca aparece):
// slug inexistente, link desativado, negócio arquivado e negócio sem logo respondem igual (404). Só devolve a imagem.
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  if (throttled(req, 'pub-logo', 120, 10 * 60_000)) return new NextResponse(null, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  const pub = await getPublicWorkspace(params.slug)
  if (!pub) return notFound()
  const ws = await db.workspace.findUnique({ where: { id: pub.id }, select: { logoUrl: true } })
  const id = logoIdFromUrl(ws?.logoUrl)
  if (!id) return notFound()
  const file = await openLogo(pub.id, id)
  if (!file) return notFound()
  return new NextResponse(Readable.toWeb(file.stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': avatarMime(id),
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      // Curto: a URL é estável (por slug), então trocar/remover a logo precisa refletir logo.
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
