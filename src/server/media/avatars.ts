import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { validateMedia } from './mime'
import { mediaRoot } from './store'

// Fotos de perfil: ficam no mesmo disco do MediaStore (MEDIA_DIR), mas FORA do prefixo dos workspaces:
// `avatars/<userId>/<id>.<ext>`. O MediaStore exige a chave `workspaceId/aaaa-mm/id.ext`, então este módulo grava
// direto no disco com as mesmas garantias (caminho conferido dentro de MEDIA_DIR, escrita atômica, modo 0600).
// Funções de caminho nunca recebem nome de arquivo do cliente: o id é gerado aqui.

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

// O último caractere do id marca o tipo (j = jpeg, p = png, w = webp); hex nunca usa essas letras. Assim a URL não
// leva ponto (o middleware ignora caminhos com ponto) e o Content-Type vem do registro, não do cliente.
const TYPES = {
  j: { mime: 'image/jpeg', ext: 'jpg' },
  p: { mime: 'image/png', ext: 'png' },
  w: { mime: 'image/webp', ext: 'webp' },
} as const
type Marker = keyof typeof TYPES

const ID_RE = /^[a-f0-9]{24}[jpw]$/
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/
export const AVATAR_URL_PREFIX = '/api/avatar/'

export const isAvatarId = (id: string): boolean => typeof id === 'string' && ID_RE.test(id)
export const avatarUrl = (id: string): string => `${AVATAR_URL_PREFIX}${id}`
/** Id do avatar de uma `fotoUrl` do PearChat, ou null (foto do Google, vazio, etc.). */
export function avatarIdFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(AVATAR_URL_PREFIX)) return null
  const id = url.slice(AVATAR_URL_PREFIX.length)
  return isAvatarId(id) ? id : null
}
export const avatarMime = (id: string): string => TYPES[id.slice(-1) as Marker].mime

// Fotos de perfil ficam em `avatars/<userId>/`; logos de negócio, no mesmo formato, em `logos/<workspaceId>/`.
type Dir = 'avatars' | 'logos'

function avatarPath(userId: string, id: string, dir: Dir = 'avatars'): string {
  if (!USER_RE.test(userId) || !isAvatarId(id)) throw new Error('Avatar inválido')
  const root = path.resolve(mediaRoot(), dir)
  const full = path.resolve(root, userId, `${id}.${TYPES[id.slice(-1) as Marker].ext}`)
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Avatar inválido')
  return full
}

export type AvatarCheck = { ok: true; marker: Marker } | { ok: false; reason: string }

/** Confere pelos primeiros bytes (nunca pelo nome ou Content-Type do cliente): só JPEG, PNG e WebP. SVG/HTML/GIF recusados. */
export function checkAvatarBytes(head: Buffer): AvatarCheck {
  const v = validateMedia({ declaredMime: '', fileName: '', head })
  if (!v.ok) return { ok: false, reason: 'Envie uma imagem JPEG, PNG ou WebP.' }
  const marker = (Object.keys(TYPES) as Marker[]).find((k) => TYPES[k].mime === v.mime)
  if (!marker) return { ok: false, reason: 'Envie uma imagem JPEG, PNG ou WebP.' }
  return { ok: true, marker }
}

/** Grava a foto e devolve o id opaco. */
export async function putAvatar(userId: string, data: Buffer, marker: Marker, dir: Dir = 'avatars'): Promise<string> {
  if (data.length > AVATAR_MAX_BYTES) throw new Error('Arquivo grande demais')
  const id = randomBytes(12).toString('hex') + marker
  const full = avatarPath(userId, id, dir)
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 })
  const tmp = `${full}.tmp-${randomBytes(6).toString('hex')}`
  try {
    await writeFile(tmp, data, { mode: 0o600 })
    await rename(tmp, full)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  return id
}

export async function deleteAvatar(userId: string, id: string, dir: Dir = 'avatars'): Promise<void> {
  try {
    await unlink(avatarPath(userId, id, dir))
  } catch {
    /* já não existe, ou id inválido */
  }
}

export async function openAvatar(userId: string, id: string, dir: Dir = 'avatars'): Promise<{ stream: Readable; size: number } | null> {
  try {
    const full = avatarPath(userId, id, dir)
    const st = await stat(full)
    if (!st.isFile()) return null
    return { stream: createReadStream(full), size: st.size }
  } catch {
    return null
  }
}

// ---- Logo do negócio (por espaço): mesmas regras e formato da foto de perfil ----
export const LOGO_URL_PREFIX = '/api/logo/'
export const logoUrl = (id: string): string => `${LOGO_URL_PREFIX}${id}`
export function logoIdFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(LOGO_URL_PREFIX)) return null
  const id = url.slice(LOGO_URL_PREFIX.length)
  return isAvatarId(id) ? id : null
}
export const putLogo = (workspaceId: string, data: Buffer, marker: Marker): Promise<string> => putAvatar(workspaceId, data, marker, 'logos')
export const deleteLogo = (workspaceId: string, id: string): Promise<void> => deleteAvatar(workspaceId, id, 'logos')
export const openLogo = (workspaceId: string, id: string) => openAvatar(workspaceId, id, 'logos')

/** Lê o corpo com teto de bytes ANTES de montar o multipart (não carrega um upload gigante na memória). null = estourou. */
export async function readBodyCapped(req: Request, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return Buffer.alloc(0)
  const reader = req.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
