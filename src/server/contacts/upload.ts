import { BodyTooLargeError, readBytesLimited } from '@/server/http/body'
import { MAX_IMPORT_BYTES } from './import-parse'

export type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413; message: string }

const TOO_BIG: BodyResult = { ok: false, status: 413, message: 'O arquivo passa do limite de 8 MB' }

/** UTF-8; se o arquivo não for UTF-8 válido (Excel antigo), cai para Windows-1252. */
export function decodeCsvBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/** Corpo lido em streaming com teto (o multipart carrega alguns bytes de cabeçalho além do arquivo). */
const MULTIPART_SLACK = 64 * 1024

async function fromMultipart(req: Request, contentType: string): Promise<BodyResult> {
  let form: FormData
  try {
    const raw = await readBytesLimited(req, MAX_IMPORT_BYTES + MULTIPART_SLACK)
    form = await new Response(raw as BodyInit, { headers: { 'content-type': contentType } }).formData()
  } catch (e) {
    if (e instanceof BodyTooLargeError) return TOO_BIG
    return { ok: false, status: 400, message: 'Envio inválido' }
  }
  const file = form.get('file')
  if (!(file instanceof File)) return { ok: false, status: 400, message: 'Envie o arquivo no campo "file"' }
  if (file.size > MAX_IMPORT_BYTES) return TOO_BIG
  return { ok: true, text: decodeCsvBytes(await file.arrayBuffer()) }
}

/** Aceita multipart (campo `file`) ou corpo text/csv. Respeita o limite de 8 MB. */
export async function readCsvBody(req: Request): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  // multipart carrega alguns bytes de cabeçalho além do arquivo
  if (declared > MAX_IMPORT_BYTES + 64 * 1024) return TOO_BIG

  const type = req.headers.get('content-type') ?? ''
  if (type.includes('multipart/form-data')) return fromMultipart(req, type)
  if (!type.includes('text/csv') && !type.includes('text/plain')) {
    return { ok: false, status: 400, message: 'Envie um arquivo CSV (multipart) ou text/csv' }
  }
  let bytes: Uint8Array
  try {
    bytes = await readBytesLimited(req, MAX_IMPORT_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return TOO_BIG
    return { ok: false, status: 400, message: 'Envio inválido' }
  }
  return { ok: true, text: decodeCsvBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) }
}
