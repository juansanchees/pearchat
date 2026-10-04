// Tipos de mídia aceitos, conferência por assinatura (magic bytes) e nomes de arquivo seguros.
// Funções puras: sem I/O. Nada aqui confia no tipo declarado pelo cliente/WhatsApp: o conteúdo manda.

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker'
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'audio', 'video', 'document', 'sticker']
export const isMediaKind = (v: unknown): v is MediaKind => typeof v === 'string' && (MEDIA_KINDS as readonly string[]).includes(v)

/** Rótulo gravado em `Message.body` quando a mídia não tem legenda (compatível com a prévia e com a IA). */
export const MEDIA_LABEL: Record<MediaKind, string> = {
  image: '[Imagem]',
  audio: '[Áudio]',
  video: '[Vídeo]',
  document: '[Documento]',
  sticker: '[Figurinha]',
}
export const isMediaLabel = (body: string): boolean => Object.values(MEDIA_LABEL).includes(body.trim())

/** Teto do que o PearChat baixa/guarda de mensagens recebidas, e do que aceita enviar. */
export const MAX_INBOUND_BYTES = 25 * 1024 * 1024
export const MAX_OUTBOUND_BYTES = 16 * 1024 * 1024

type Family = 'jpeg' | 'png' | 'webp' | 'gif' | 'ogg' | 'mp3' | 'aac' | 'wav' | 'iso' | 'webm' | 'pdf' | 'zip' | 'ole' | 'text'

type Entry = { mime: string; kind: MediaKind; ext: string; families: Family[]; inline: boolean }

const OFFICE_ZIP: [string, string][] = [
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
]
const OFFICE_OLE: [string, string][] = [
  ['application/msword', 'doc'],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.ms-powerpoint', 'ppt'],
]

const ENTRIES: Entry[] = [
  { mime: 'image/jpeg', kind: 'image', ext: 'jpg', families: ['jpeg'], inline: true },
  { mime: 'image/png', kind: 'image', ext: 'png', families: ['png'], inline: true },
  { mime: 'image/webp', kind: 'image', ext: 'webp', families: ['webp'], inline: true },
  { mime: 'image/gif', kind: 'image', ext: 'gif', families: ['gif'], inline: true },
  { mime: 'audio/ogg', kind: 'audio', ext: 'ogg', families: ['ogg'], inline: true },
  { mime: 'audio/mpeg', kind: 'audio', ext: 'mp3', families: ['mp3'], inline: true },
  { mime: 'audio/mp4', kind: 'audio', ext: 'm4a', families: ['iso'], inline: true },
  { mime: 'audio/aac', kind: 'audio', ext: 'aac', families: ['aac'], inline: true },
  { mime: 'audio/wav', kind: 'audio', ext: 'wav', families: ['wav'], inline: true },
  { mime: 'video/mp4', kind: 'video', ext: 'mp4', families: ['iso'], inline: true },
  { mime: 'video/quicktime', kind: 'video', ext: 'mov', families: ['iso'], inline: true },
  { mime: 'video/3gpp', kind: 'video', ext: '3gp', families: ['iso'], inline: true },
  { mime: 'video/webm', kind: 'video', ext: 'webm', families: ['webm'], inline: true },
  { mime: 'application/pdf', kind: 'document', ext: 'pdf', families: ['pdf'], inline: false },
  ...OFFICE_ZIP.map(([mime, ext]): Entry => ({ mime, kind: 'document', ext, families: ['zip'], inline: false })),
  ...OFFICE_OLE.map(([mime, ext]): Entry => ({ mime, kind: 'document', ext, families: ['ole'], inline: false })),
  { mime: 'text/plain', kind: 'document', ext: 'txt', families: ['text'], inline: false },
  { mime: 'text/csv', kind: 'document', ext: 'csv', families: ['text'], inline: false },
]

const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/x-aac': 'audio/aac',
  'audio/opus': 'audio/ogg',
  'application/ogg': 'audio/ogg',
  'video/x-m4v': 'video/mp4',
  'application/x-pdf': 'application/pdf',
}

/** "audio/ogg; codecs=opus" -> "audio/ogg" (minúsculo, sem parâmetros, com apelidos resolvidos). */
export function normalizeMime(mime: string | null | undefined): string {
  const base = (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return ALIASES[base] ?? base
}

const EXT_TO_MIME = new Map<string, string>(ENTRIES.map((e) => [e.ext, e.mime]))
EXT_TO_MIME.set('jpeg', 'image/jpeg')
EXT_TO_MIME.set('opus', 'audio/ogg')
EXT_TO_MIME.set('oga', 'audio/ogg')

const startsWith = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1')

/** Família do arquivo pelos primeiros bytes. null = não reconhecido (ou texto puro, tratado à parte). */
export function sniffFamily(head: Buffer): Family | null {
  if (head.length < 4) return null
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (ascii(head, 0, 4) === 'GIF8') return 'gif'
  if (ascii(head, 0, 4) === 'RIFF' && head.length >= 12) {
    const t = ascii(head, 8, 12)
    if (t === 'WEBP') return 'webp'
    if (t === 'WAVE') return 'wav'
    return null
  }
  if (ascii(head, 0, 4) === 'OggS') return 'ogg'
  if (ascii(head, 0, 3) === 'ID3') return 'mp3'
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    // Cabeçalho de quadro MPEG: camada 00 = AAC (ADTS); demais = MP3.
    return ((head[1] ?? 0) & 0x06) === 0 ? 'aac' : 'mp3'
  }
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') return 'iso'
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  if (ascii(head, 0, 5) === '%PDF-') return 'pdf'
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'
  return null
}

/** Texto puro "inofensivo": sem NUL, sem controle estranho e sem cara de HTML/SVG/script/executável. */
function looksLikePlainText(head: Buffer): boolean {
  const sample = head.subarray(0, 4096)
  if (sample.length === 0) return false
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i] as number
    if (byte === 0) return false
    if (byte < 9 || (byte > 13 && byte < 32)) return false
  }
  const s = sample.toString('utf8').trimStart().slice(0, 64).toLowerCase()
  if (s.startsWith('<') || s.startsWith('#!') || s.startsWith('mz')) return false
  return true
}

export type ValidatedMedia = { ok: true; mime: string; kind: MediaKind; ext: string; inline: boolean }
export type RejectedMedia = { ok: false; reason: string }

const MISMATCH = 'O tipo do arquivo não corresponde ao conteúdo'
const NOT_ALLOWED = 'Tipo de arquivo não permitido'

function result(e: Entry, expectedKind: MediaKind | undefined): ValidatedMedia {
  const kind: MediaKind = expectedKind === 'sticker' && e.mime === 'image/webp' ? 'sticker' : e.kind
  return { ok: true, mime: e.mime, kind, ext: e.ext, inline: e.inline }
}

/**
 * Confere um arquivo: tipo declarado (pode ser vazio/errado), nome e primeiros bytes. Devolve o tipo FINAL (o que o
 * conteúdo prova) ou o motivo da recusa. `expectedKind` vem do WhatsApp (ex.: audioMessage) e resolve casos ambíguos
 * (um MP4 "de áudio"); nunca libera conteúdo que não bate com a lista.
 */
export function validateMedia(input: { declaredMime?: string | null; fileName?: string | null; head: Buffer; expectedKind?: MediaKind }): ValidatedMedia | RejectedMedia {
  const { head, expectedKind } = input
  const declared = normalizeMime(input.declaredMime)
  const ext = (input.fileName ?? '').split('.').pop()?.toLowerCase() ?? ''
  const family = sniffFamily(head)
  const textual = family === null && looksLikePlainText(head)
  const wanted = expectedKind === 'sticker' ? 'image' : expectedKind
  const mp4Audio = ENTRIES.find((e) => e.mime === 'audio/mp4')!

  if (!family && !textual) return { ok: false, reason: NOT_ALLOWED }
  const fits = (e: Entry) => (family ? e.families.includes(family) : e.families.includes('text'))
  const declaredEntry = ENTRIES.find((e) => e.mime === declared)

  // 1) O tipo declarado é conhecido e o conteúdo confirma.
  if (declaredEntry && fits(declaredEntry)) {
    if (wanted && declaredEntry.kind !== wanted) {
      // Ex.: áudio do WhatsApp rotulado "video/mp4" (contêiner MP4 só com som).
      if (family === 'iso' && wanted === 'audio') return result(mp4Audio, expectedKind)
      return { ok: false, reason: MISMATCH }
    }
    return result(declaredEntry, expectedKind)
  }

  // 2) Declarado algo desconhecido que não é genérico (ex.: "text/html", "image/svg+xml"): recusa.
  const generic = declared === '' || declared === 'application/octet-stream' || declared === 'binary/octet-stream'
  if (!declaredEntry && !generic) return { ok: false, reason: NOT_ALLOWED }

  // 3) Declarado conhecido mas o conteúdo é outro: só aceita se for da mesma natureza (ex.: PNG rotulado JPEG).
  const candidates = ENTRIES.filter(fits)
  let pick: Entry | undefined
  if (candidates.length === 1) pick = candidates[0]
  else if (family === 'iso') pick = wanted === 'audio' ? mp4Audio : candidates.find((e) => e.mime === EXT_TO_MIME.get(ext) && e.kind !== 'audio') ?? candidates.find((e) => e.mime === 'video/mp4')
  else pick = candidates.find((e) => e.mime === EXT_TO_MIME.get(ext))
  if (!pick) return { ok: false, reason: NOT_ALLOWED }
  if (declaredEntry && declaredEntry.kind !== pick.kind) return { ok: false, reason: MISMATCH }
  if (wanted && pick.kind !== wanted) return { ok: false, reason: MISMATCH }
  return result(pick, expectedKind)
}

/** Tipo de mídia (image/audio/...) de um MIME aceito; null se não estiver na lista. */
export function kindOfMime(mime: string): MediaKind | null {
  return ENTRIES.find((e) => e.mime === normalizeMime(mime))?.kind ?? null
}

/** Seguro para `Content-Disposition: inline`? Só imagem/áudio/vídeo de tipos conhecidos (nunca SVG/HTML/PDF). */
export function isInlineSafe(mime: string): boolean {
  return ENTRIES.some((e) => e.mime === normalizeMime(mime) && e.inline)
}

export function extForMime(mime: string): string {
  return ENTRIES.find((e) => e.mime === normalizeMime(mime))?.ext ?? 'bin'
}

/** Nome de arquivo seguro para exibir/baixar: sem caminho, sem controle, sem aspas, até 80 caracteres. */
export function sanitizeFileName(name: string | null | undefined, fallbackExt = 'bin'): string {
  let n = (name ?? '').normalize('NFC')
  n = n.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  n = n.replace(/[\u0000-\u001f\u007f"<>:*?|‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
  n = n.replace(/^\.+/, '')
  if (n.length > 80) {
    const dot = n.lastIndexOf('.')
    const e = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : ''
    n = n.slice(0, 80 - e.length) + e
  }
  return n || `arquivo.${fallbackExt}`
}

/** Valor de `Content-Disposition` com nome ASCII de reserva + filename* (RFC 5987) para acentos. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"%;]/g, '_')
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/** Duração m:ss. */
export function formatDuration(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
