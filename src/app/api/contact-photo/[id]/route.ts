import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { avatarMime, contactPhotoUrl, isAvatarId, openContactPhoto } from '@/server/media/avatars'
import { apiSession, unauthorized } from '@/server/settings/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

// Foto do contato (copiada do WhatsApp pelo servidor): exige sessão e que o contato seja do ESPAÇO da sessão (o espaço da
// sessão já é validado no servidor: atendente só nos espaços liberados). Contato de outro espaço ou organização = 404.
// O arquivo é achado pelo id opaco gravado em Contact.photoUrl; o Content-Type vem do id (validado ao baixar); nunca SVG.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!isAvatarId(params.id)) return notFound()

  const contact = await db.contact.findFirst({ where: { workspaceId: s.workspaceId, photoUrl: contactPhotoUrl(params.id) }, select: { workspaceId: true } })
  if (!contact) return notFound()

  const file = await openContactPhoto(contact.workspaceId, params.id)
  if (!file) return notFound()
  return new NextResponse(Readable.toWeb(file.stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': avatarMime(params.id),
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
