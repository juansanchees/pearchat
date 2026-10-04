import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { denyUnless } from '@/server/auth/guard'
import { AVATAR_MAX_BYTES, checkAvatarBytes, deleteLogo, logoIdFromUrl, logoUrl, putLogo, readBodyCapped } from '@/server/media/avatars'
import { fail, notFound, unauthorized } from '@/server/settings/http'
import { orgSession, validSpaceId } from '@/server/spaces/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Margem do multipart (limites, cabeçalhos) sobre os 2 MB da imagem.
const BODY_CAP = AVATAR_MAX_BYTES + 64 * 1024

// Logo do negócio de um espaço: mesmas regras da foto de perfil (/api/me/avatar). Só quem gerencia o espaço
// (settings.workspace) e só espaços da PRÓPRIA organização da sessão; qualquer outro id é "não encontrado".
async function ownSpace(id: string) {
  const s = await orgSession()
  if (!s) return { res: unauthorized() }
  if (!validSpaceId(id)) return { res: notFound('Espaço') }
  const ws = await db.workspace.findFirst({ where: { id, organizationId: s.organizationId, arquivadoEm: null }, select: { id: true, logoUrl: true } })
  return ws ? { ws } : { res: notFound('Espaço') }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('settings.workspace'); if (deny) return deny
  const own = await ownSpace(params.id)
  if (!own.ws) return own.res

  const ct = req.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data/i.test(ct)) return fail('Envie a imagem como arquivo.', 415)
  const raw = await readBodyCapped(req, BODY_CAP)
  if (!raw) return fail('A logo precisa ter até 2 MB.', 413)

  let file: FormDataEntryValue | null
  try {
    const form = await new Response(new Uint8Array(raw), { headers: { 'content-type': ct } }).formData()
    file = form.get('file')
  } catch {
    return fail('Arquivo inválido.')
  }
  if (!file || typeof file === 'string') return fail('Envie a imagem no campo "file".')
  if (file.size === 0) return fail('O arquivo está vazio.')
  if (file.size > AVATAR_MAX_BYTES) return fail('A logo precisa ter até 2 MB.', 413)

  const data = Buffer.from(await file.arrayBuffer())
  const check = checkAvatarBytes(data.subarray(0, 64))
  if (!check.ok) return fail(check.reason, 415)

  const id = await putLogo(own.ws.id, data, check.marker)
  const url = logoUrl(id)
  try {
    await db.workspace.update({ where: { id: own.ws.id }, data: { logoUrl: url } })
  } catch (e) {
    await deleteLogo(own.ws.id, id)
    throw e
  }
  const old = logoIdFromUrl(own.ws.logoUrl)
  if (old) await deleteLogo(own.ws.id, old)
  return NextResponse.json({ logoUrl: url })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const deny = await denyUnless('settings.workspace'); if (deny) return deny
  const own = await ownSpace(params.id)
  if (!own.ws) return own.res
  await db.workspace.update({ where: { id: own.ws.id }, data: { logoUrl: null } })
  const old = logoIdFromUrl(own.ws.logoUrl)
  if (old) await deleteLogo(own.ws.id, old)
  return NextResponse.json({ logoUrl: null })
}
