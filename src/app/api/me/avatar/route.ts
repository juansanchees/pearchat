import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AVATAR_MAX_BYTES, avatarIdFromUrl, avatarUrl, checkAvatarBytes, deleteAvatar, putAvatar, readBodyCapped } from '@/server/media/avatars'
import { apiSession, fail, unauthorized } from '@/server/settings/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Margem do multipart (limites, cabeçalhos) sobre os 2 MB da imagem.
const BODY_CAP = AVATAR_MAX_BYTES + 64 * 1024

/** Troca a foto de perfil. A imagem chega já recortada/redimensionada pelo navegador, mas é conferida aqui pela assinatura. */
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()

  const ct = req.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data/i.test(ct)) return fail('Envie a imagem como arquivo.', 415)
  const raw = await readBodyCapped(req, BODY_CAP)
  if (!raw) return fail('A foto precisa ter até 2 MB.', 413)

  let file: FormDataEntryValue | null
  try {
    const form = await new Response(new Uint8Array(raw), { headers: { 'content-type': ct } }).formData()
    file = form.get('file')
  } catch {
    return fail('Arquivo inválido.')
  }
  if (!file || typeof file === 'string') return fail('Envie a imagem no campo "file".')
  if (file.size === 0) return fail('O arquivo está vazio.')
  if (file.size > AVATAR_MAX_BYTES) return fail('A foto precisa ter até 2 MB.', 413)

  const data = Buffer.from(await file.arrayBuffer())
  const check = checkAvatarBytes(data.subarray(0, 64))
  if (!check.ok) return fail(check.reason, 415)

  const user = await db.user.findUnique({ where: { id: s.userId }, select: { fotoUrl: true } })
  if (!user) return unauthorized()
  const id = await putAvatar(s.userId, data, check.marker)
  const fotoUrl = avatarUrl(id)
  try {
    await db.user.update({ where: { id: s.userId }, data: { fotoUrl } })
  } catch (e) {
    await deleteAvatar(s.userId, id)
    throw e
  }
  // Apaga a foto anterior do MESMO usuário (o id sai da fotoUrl dele; nada vem do cliente).
  const old = avatarIdFromUrl(user.fotoUrl)
  if (old) await deleteAvatar(s.userId, old)
  return NextResponse.json({ fotoUrl })
}

export async function DELETE() {
  const s = await apiSession()
  if (!s) return unauthorized()
  const user = await db.user.findUnique({ where: { id: s.userId }, select: { fotoUrl: true, image: true } })
  if (!user) return unauthorized()
  await db.user.update({ where: { id: s.userId }, data: { fotoUrl: null } })
  const old = avatarIdFromUrl(user.fotoUrl)
  if (old) await deleteAvatar(s.userId, old)
  // Sem foto própria, volta a foto do Google (se houver).
  return NextResponse.json({ fotoUrl: user.image ?? null })
}
