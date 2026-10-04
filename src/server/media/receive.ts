import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import { startTranscription } from '@/server/engine/transcribe'
import { logError } from '@/server/engine/util'
import { getProvider } from '@/server/whatsapp'
import { emitMessageUpdated } from './events'
import { isMediaKind, MAX_INBOUND_BYTES, sanitizeFileName, validateMedia } from './mime'
import { buildMediaKey, getMediaStore } from './store'

// Download da mídia de mensagens RECEBIDAS (e das respostas dadas pelo celular). A Message já foi gravada com
// mediaStatus = pendente; aqui o arquivo é baixado SÓ da Evolution configurada, validado e guardado no MediaStore.
// Sem SSRF: nenhuma URL do webhook é seguida. Nada de base64, nomes de arquivo ou transcrição nos logs.

const RETRY_DELAYS_MS = [0, 3_000, 8_000]
const CONCURRENCY = 3
const SWEEP_MIN_AGE_MS = 90_000
const SWEEP_GIVE_UP_MS = 30 * 60_000

const g = globalThis as unknown as { __pearchat_media_dl?: { active: Set<string>; running: number; queue: (() => void)[] } }
const dl = (g.__pearchat_media_dl ??= { active: new Set<string>(), running: 0, queue: [] })

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (dl.running >= CONCURRENCY) await new Promise<void>((resolve) => dl.queue.push(resolve))
  dl.running++
  try {
    return await fn()
  } finally {
    dl.running--
    dl.queue.shift()?.()
  }
}

async function fail(messageId: string, wasAudio: boolean): Promise<void> {
  await db.message.update({
    where: { id: messageId },
    data: { mediaStatus: 'erro', ...(wasAudio ? { transcriptStatus: 'erro' } : {}) },
  })
  await emitMessageUpdated(messageId)
}

/** Baixa e guarda a mídia de uma mensagem com mediaStatus = pendente. Nunca lança. */
export async function runInboundMedia(messageId: string, inlineBase64?: string): Promise<void> {
  if (dl.active.has(messageId)) return
  dl.active.add(messageId)
  try {
    await withSlot(() => download(messageId, inlineBase64))
  } catch (e) {
    logError('media', `falha inesperada (mensagem ${messageId})`, e)
    await fail(messageId, false).catch(() => {})
  } finally {
    dl.active.delete(messageId)
  }
}

/** Dispara o download em segundo plano (o ingest não espera). */
export function startInboundMedia(messageId: string, inlineBase64?: string): void {
  void runInboundMedia(messageId, inlineBase64)
}

async function download(messageId: string, inlineBase64?: string): Promise<void> {
  const m = await db.message.findUnique({ where: { id: messageId }, include: { conversation: { select: { workspaceId: true } } } })
  if (!m || !m.mediaType || !isMediaKind(m.mediaType)) return
  if (m.mediaStatus === 'ok' || m.mediaStatus === 'expirada') return
  const workspaceId = m.conversation.workspaceId
  const wasAudio = m.mediaType === 'audio' && m.transcriptStatus === 'pendente'

  // Histórico importado: só metadados.
  if (m.imported) {
    await db.message.update({ where: { id: messageId }, data: { mediaStatus: 'expirada' } })
    await emitMessageUpdated(messageId)
    return
  }
  // Tamanho anunciado pelo WhatsApp acima do teto: nem tenta (evita carregar um arquivo gigante na memória).
  if ((m.mediaSize ?? 0) > MAX_INBOUND_BYTES) {
    await fail(messageId, wasAudio)
    return
  }

  let data: Buffer | null = null
  let mime: string | undefined
  let name: string | undefined

  if (inlineBase64) {
    // Base64 que veio no próprio webhook: confere o tamanho ANTES de decodificar.
    if (Math.floor((inlineBase64.length * 3) / 4) <= MAX_INBOUND_BYTES) data = Buffer.from(inlineBase64, 'base64')
  }
  if (!data) {
    const session = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { provider: true } })
    const provider = getProvider(session?.provider ? providerToKind(session.provider) : 'rapida')
    if (!provider.fetchMedia) {
      await fail(messageId, wasAudio)
      return
    }
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length && !data; attempt++) {
      if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]!)
      try {
        const got = await provider.fetchMedia(workspaceId, { providerMessageId: m.providerMessageId ?? '', providerMediaId: m.providerMediaId ?? undefined, maxBytes: MAX_INBOUND_BYTES })
        data = got.data
        mime = got.mime
        name = got.fileName
      } catch (e) {
        // 413 (grande demais) e 404 não melhoram com nova tentativa.
        const status = typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 0
        if (status === 413) break
        if (attempt === RETRY_DELAYS_MS.length - 1) logError('media', `download falhou (mensagem ${messageId})`, e)
      }
    }
  }

  if (!data || data.length === 0 || data.length > MAX_INBOUND_BYTES) {
    await fail(messageId, wasAudio)
    return
  }
  const v = validateMedia({ declaredMime: mime ?? m.mediaMime, fileName: name ?? m.mediaName, head: data.subarray(0, 4096), expectedKind: m.mediaType })
  if (!v.ok) {
    logError('media', `arquivo recusado (mensagem ${messageId})`, new Error(v.reason))
    await fail(messageId, wasAudio)
    return
  }

  const key = buildMediaKey(workspaceId, v.ext)
  await getMediaStore().put(key, data, { mime: v.mime }, { maxBytes: MAX_INBOUND_BYTES })
  await db.message.update({
    where: { id: messageId },
    data: {
      mediaKey: key,
      mediaMime: v.mime,
      mediaSize: data.length,
      mediaName: sanitizeFileName(name ?? m.mediaName, v.ext),
      mediaType: v.kind,
      mediaStatus: 'ok',
    },
  })
  await emitMessageUpdated(messageId)
  if (wasAudio) startTranscription(messageId)
}

/** Tarefa do agendador: retoma downloads que ficaram "pendente" (servidor reiniciou) e desiste dos muito antigos. */
export async function runDueMediaDownloads(): Promise<number> {
  const now = Date.now()
  const rows = await db.message.findMany({
    where: { mediaStatus: 'pendente', imported: false, createdAt: { lt: new Date(now - SWEEP_MIN_AGE_MS) } },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true, createdAt: true, mediaType: true, transcriptStatus: true },
  })
  let n = 0
  for (const r of rows) {
    if (dl.active.has(r.id)) continue
    if (now - r.createdAt.getTime() > SWEEP_GIVE_UP_MS) {
      await fail(r.id, r.mediaType === 'audio' && r.transcriptStatus === 'pendente')
      continue
    }
    await runInboundMedia(r.id)
    n++
  }
  return n
}
