import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { avatarMime, isAvatarId, logoUrl, openLogo } from '@/server/media/avatars'
import { apiSession, unauthorized } from '@/server/settings/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

// Logo do negócio dentro do app: exige sessão e que o espaço dono da imagem seja da MESMA organização de quem pede.
// O espaço é descoberto pelo id opaco gravado em Workspace.logoUrl; o Content-Type vem do id (validado no upload).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!isAvatarId(params.id)) return notFound()

  const [ws, me] = await Promise.all([
    db.workspace.findFirst({ where: { logoUrl: logoUrl(params.id) }, select: { id: true, organizationId: true } }),
    db.user.findUnique({ where: { id: s.userId }, select: { organizationId: true } }),
  ])
  if (!ws || !me || ws.organizationId === null || ws.organizationId !== me.organizationId) return notFound()

  const file = await openLogo(ws.id, params.id)
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
