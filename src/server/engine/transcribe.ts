import { db } from '@/lib/db'
import { emitMessageUpdated } from '@/server/media/events'
import { markTranscriptionUnavailable, transcriptionAvailable } from '@/server/media/ai-caps'
import { extForMime } from '@/server/media/mime'
import { getMediaStore } from '@/server/media/store'
import { MAX_TRANSCRIBE_BYTES, MAX_TRANSCRIBE_SECONDS, TranscribeError, transcribeAudio } from '@/server/media/transcribe'
import { bumpUsage, logError } from './util'

// Transcrição de áudio RECEBIDO. Roda logo depois do download (em segundo plano) e o agendador varre o que sobrou
// (servidor reiniciado no meio). Nunca loga o texto transcrito.

const ATTEMPTS = 2
const RETRY_GAP_MS = 2_500
const SWEEP_MIN_AGE_MS = 60_000
const SWEEP_GIVE_UP_MS = 20 * 60_000
const SWEEP_BATCH = 20

const g = globalThis as unknown as { __pearchat_transcribing?: Set<string> }
const active = (g.__pearchat_transcribing ??= new Set<string>())

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function setStatus(messageId: string, data: { transcriptStatus: string; transcript?: string }): Promise<void> {
  await db.message.update({ where: { id: messageId }, data })
  await emitMessageUpdated(messageId)
}

/** Transcreve um áudio recebido que está com `transcriptStatus = pendente` e já foi baixado. Nunca lança. */
export async function runTranscription(messageId: string): Promise<void> {
  if (active.has(messageId)) return
  active.add(messageId)
  try {
    const m = await db.message.findUnique({ where: { id: messageId }, include: { conversation: { select: { workspaceId: true } } } })
    if (!m || m.mediaType !== 'audio' || m.direction !== 'IN' || m.imported || m.transcriptStatus !== 'pendente') return
    if (m.mediaStatus !== 'ok' || !m.mediaKey) return // ainda não baixou (ou não baixou): o download dispara a transcrição

    const tooLong = (m.mediaDurationSec ?? 0) > MAX_TRANSCRIBE_SECONDS
    const tooBig = (m.mediaSize ?? 0) > MAX_TRANSCRIBE_BYTES
    if (tooLong || tooBig || !transcriptionAvailable()) {
      await setStatus(messageId, { transcriptStatus: 'indisponivel' })
      return
    }
    const data = await getMediaStore().read(m.mediaKey, MAX_TRANSCRIBE_BYTES)
    if (!data) {
      await setStatus(messageId, { transcriptStatus: 'erro' })
      return
    }

    let text: string | null = null
    let finalStatus: 'erro' | 'indisponivel' = 'erro'
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        text = await transcribeAudio({ data, fileName: `audio.${extForMime(m.mediaMime ?? 'audio/ogg')}`, mime: m.mediaMime ?? 'audio/ogg' })
        break
      } catch (e) {
        if (e instanceof TranscribeError && e.unavailable) {
          markTranscriptionUnavailable()
          finalStatus = 'indisponivel'
          break
        }
        if (!(e instanceof TranscribeError) || !e.retryable || attempt === ATTEMPTS) {
          logError('transcribe', `mensagem ${messageId}`, e)
          break
        }
        await sleep(RETRY_GAP_MS)
      }
    }
    if (text === null) {
      await setStatus(messageId, { transcriptStatus: finalStatus })
      return
    }
    const seconds = m.mediaDurationSec && m.mediaDurationSec > 0 ? m.mediaDurationSec : Math.max(1, Math.round((m.mediaSize ?? 0) / 2000))
    await bumpUsage(m.conversation.workspaceId, { transcricoesSeg: seconds })
    await setStatus(messageId, { transcriptStatus: 'feito', transcript: text })
  } catch (e) {
    logError('transcribe', `falha inesperada (mensagem ${messageId})`, e)
  } finally {
    active.delete(messageId)
  }
}

/** Dispara em segundo plano (sem esperar). */
export function startTranscription(messageId: string): void {
  void runTranscription(messageId)
}

/** Tarefa do agendador: retoma transcrições que ficaram pendentes e desiste das muito antigas. */
export async function runDueTranscriptions(): Promise<number> {
  const now = Date.now()
  const rows = await db.message.findMany({
    where: { transcriptStatus: 'pendente', mediaStatus: 'ok', createdAt: { lt: new Date(now - SWEEP_MIN_AGE_MS) } },
    orderBy: { createdAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true, createdAt: true },
  })
  let n = 0
  for (const r of rows) {
    if (active.has(r.id)) continue
    if (now - r.createdAt.getTime() > SWEEP_GIVE_UP_MS) {
      await setStatus(r.id, { transcriptStatus: 'erro' })
      continue
    }
    await runTranscription(r.id)
    n++
  }
  return n
}
