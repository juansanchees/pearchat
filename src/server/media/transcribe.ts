import { transcribeModel } from './ai-caps'

// Cliente de /v1/audio/transcriptions da OpenAI. Nunca loga o texto transcrito, a chave nem o corpo de erro.

export const MAX_TRANSCRIBE_SECONDS = 5 * 60
export const MAX_TRANSCRIBE_BYTES = 20 * 1024 * 1024

export class TranscribeError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    /** O projeto/chave não tem acesso ao modelo (ou a chave é inválida): não adianta tentar de novo. */
    public readonly unavailable: boolean,
    /** Vale uma nova tentativa (rede, 429, 5xx). */
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'TranscribeError'
  }
}

const openAiBase = () => (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')

const timeoutMs = () => {
  const n = Number(process.env.TRANSCRIBE_TIMEOUT_MS)
  return Number.isFinite(n) && n >= 200 ? n : 60_000
}

export async function transcribeAudio(input: { data: Buffer; fileName: string; mime: string }): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw new TranscribeError('Sem chave da OpenAI', null, true, false)
  const form = new FormData()
  form.append('model', transcribeModel())
  form.append('language', 'pt')
  form.append('response_format', 'json')
  form.append('file', new Blob([new Uint8Array(input.data)], { type: input.mime }), input.fileName)

  let res: Response
  try {
    res = await fetch(`${openAiBase()}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs()),
    })
  } catch (e) {
    throw new TranscribeError(e instanceof Error && e.name === 'TimeoutError' ? 'Transcrição demorou demais' : 'Serviço de transcrição indisponível', null, false, true)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    const unavailable = res.status === 401 || res.status === 403 || res.status === 404
    const retryable = res.status === 429 || res.status >= 500
    throw new TranscribeError(`Serviço de transcrição respondeu ${res.status}`, res.status, unavailable, retryable)
  }
  const json = (await res.json().catch(() => null)) as { text?: unknown } | null
  if (!json || typeof json.text !== 'string') throw new TranscribeError('Resposta inválida do serviço de transcrição', res.status, false, true)
  return json.text.trim()
}
