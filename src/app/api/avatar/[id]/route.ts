import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { avatarMime, avatarUrl, isAvatarId, openAvatar } from '@/server/media/avatars'
import { apiSession, unauthorized } from '@/server/settings/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })

// Foto de perfil: exige sessão e que quem pede seja da mesma ORGANIZAÇÃO do dono (ou o próprio dono).
// O dono é descoberto pelo id opaco gravado em User.fotoUrl; o Content-Type vem do id (validado no upload).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await apiSession()
  if (!s) return unauthorized()
  if (!isAvatarId(params.id)) return notFound()

  const [owner, me] = await Promise.all([
    db.user.findFirst({ where: { fotoUrl: avatarUrl(params.id) }, select: { id: true, organizationId: true } }),
    db.user.findUnique({ where: { id: s.userId }, select: { id: true, organizationId: true } }),
  ])
  if (!owner || !me) return notFound()
  const allowed = owner.id === me.id || (owner.organizationId !== null && owner.organizationId === me.organizationId)
  if (!allowed) return notFound()

  const file = await openAvatar(owner.id, params.id)
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
