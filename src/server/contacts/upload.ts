import { MAX_IMPORT_BYTES } from './import-parse'

export type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413; message: string }

const TOO_BIG: BodyResult = { ok: false, status: 413, message: 'O arquivo passa do limite de 2 MB' }

/** UTF-8; se o arquivo não for UTF-8 válido (Excel antigo), cai para Windows-1252. */
export function decodeCsvBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

async function fromMultipart(req: Request): Promise<BodyResult> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return { ok: false, status: 400, message: 'Envio inválido' }
  }
  const file = form.get('file')
  if (!(file instanceof File)) return { ok: false, status: 400, message: 'Envie o arquivo no campo "file"' }
  if (file.size > MAX_IMPORT_BYTES) return TOO_BIG
  return { ok: true, text: decodeCsvBytes(await file.arrayBuffer()) }
}

/** Aceita multipart (campo `file`) ou corpo text/csv. Respeita o limite de 2 MB. */
export async function readCsvBody(req: Request): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  // multipart carrega alguns bytes de cabeçalho além do arquivo
  if (declared > MAX_IMPORT_BYTES + 64 * 1024) return TOO_BIG

  const type = req.headers.get('content-type') ?? ''
  if (type.includes('multipart/form-data')) return fromMultipart(req)
  if (!type.includes('text/csv') && !type.includes('text/plain')) {
    return { ok: false, status: 400, message: 'Envie um arquivo CSV (multipart) ou text/csv' }
  }
  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_IMPORT_BYTES) return TOO_BIG
  return { ok: true, text: decodeCsvBytes(buf) }
}
