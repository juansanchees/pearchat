import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Armazenamento das mídias das conversas atrás de uma interface, para trocar o disco por S3 depois sem mexer no resto.
// A chave é sempre `workspaceId/aaaa-mm/<id>.<ext>`; nunca vem do cliente.
//
// LIMPEZA (futuro): tudo de um workspace vive sob `<MEDIA_DIR>/<workspaceId>/`, então apagar um espaço é apagar essa
// pasta (ou o prefixo no S3). Nesta etapa nada é apagado ao arquivar/excluir conversas.

export type MediaMeta = { mime: string }
export type MediaRange = { start: number; end: number }

export interface MediaStore {
  /** Grava (atomicamente) e devolve o tamanho. `maxBytes` interrompe e lança MediaTooLargeError ao estourar. */
  put(key: string, data: Buffer | Readable, meta: MediaMeta, opts?: { maxBytes?: number }): Promise<{ size: number }>
  /** Stream + tamanho total; com `range` (inclusivo) devolve só o trecho. null se não existir. */
  get(key: string, range?: MediaRange): Promise<{ stream: Readable; size: number; start: number; end: number } | null>
  /** Lê tudo para a memória (uso interno: transcrição/visão). Respeita `maxBytes`. */
  read(key: string, maxBytes: number): Promise<Buffer | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

export class MediaTooLargeError extends Error {
  constructor() {
    super('Arquivo grande demais')
    this.name = 'MediaTooLargeError'
  }
}
export class InvalidMediaKeyError extends Error {
  constructor() {
    super('Chave de mídia inválida')
    this.name = 'InvalidMediaKeyError'
  }
}

const KEY_RE = /^[A-Za-z0-9_-]{1,64}\/\d{4}-(0[1-9]|1[0-2])\/[A-Za-z0-9_-]{8,64}\.[a-z0-9]{1,8}$/

export function isValidMediaKey(key: string): boolean {
  return typeof key === 'string' && key.length <= 160 && KEY_RE.test(key)
}

/** `workspaceId/aaaa-mm/<id>.<ext>`. O id é aleatório (não adivinhável); a extensão vem do tipo JÁ validado. */
export function buildMediaKey(workspaceId: string, ext: string, now = new Date()): string {
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
  const mm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const id = `m${now.getTime().toString(36)}${randomBytes(9).toString('hex')}`
  const key = `${workspaceId}/${mm}/${id}.${safeExt}`
  if (!isValidMediaKey(key)) throw new InvalidMediaKeyError()
  return key
}

export const mediaRoot = () => path.resolve(process.env.MEDIA_DIR?.trim() || path.join(process.cwd(), '.media'))

/** Caminho absoluto da chave, conferido: precisa ficar DENTRO de MEDIA_DIR (barra path traversal). */
export function resolveMediaPath(key: string, root = mediaRoot()): string {
  if (!isValidMediaKey(key)) throw new InvalidMediaKeyError()
  const full = path.resolve(root, ...key.split('/'))
  const rel = path.relative(root, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new InvalidMediaKeyError()
  return full
}

class DiskMediaStore implements MediaStore {
  async put(key: string, data: Buffer | Readable, _meta: MediaMeta, opts: { maxBytes?: number } = {}): Promise<{ size: number }> {
    const full = resolveMediaPath(key)
    const max = opts.maxBytes
    if (Buffer.isBuffer(data) && max !== undefined && data.length > max) throw new MediaTooLargeError()
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 })
    const tmp = `${full}.tmp-${randomBytes(6).toString('hex')}`
    let size = 0
    try {
      if (Buffer.isBuffer(data)) {
        await writeFile(tmp, data, { mode: 0o600 })
        size = data.length
      } else {
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            size += chunk.length
            if (max !== undefined && size > max) cb(new MediaTooLargeError())
            else cb(null, chunk)
          },
        })
        await pipeline(data, counter, createWriteStream(tmp, { mode: 0o600 }))
      }
      await rename(tmp, full)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
    return { size }
  }

  async get(key: string, range?: MediaRange) {
    const full = resolveMediaPath(key)
    let size: number
    try {
      const st = await stat(full)
      if (!st.isFile()) return null
      size = st.size
    } catch {
      return null
    }
    const start = range ? Math.max(0, range.start) : 0
    const end = range ? Math.min(size - 1, range.end) : size - 1
    if (size === 0) return { stream: createReadStream(full), size, start: 0, end: -1 }
    if (start > end) return null
    return { stream: createReadStream(full, { start, end }), size, start, end }
  }

  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    const full = resolveMediaPath(key)
    try {
      const st = await stat(full)
      if (!st.isFile() || st.size > maxBytes) return null
      return await readFile(full)
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(resolveMediaPath(key)).catch(() => {})
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(resolveMediaPath(key))).isFile()
    } catch {
      return false
    }
  }
}

const g = globalThis as unknown as { __pearchat_media_store?: MediaStore }
export function getMediaStore(): MediaStore {
  return (g.__pearchat_media_store ??= new DiskMediaStore())
}
