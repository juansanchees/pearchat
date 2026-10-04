// O que a chave de IA configurada consegue fazer com mídia. Detectado em tempo de execução e guardado em memória:
// a resposta "não" vale por algumas horas, para não testar a cada mensagem (e para o projeto da OpenAI poder liberar
// o modelo e o PearChat perceber sozinho, sem reiniciar).
//
// Variáveis:
//   AI_TRANSCRIBE_MODEL  modelo de /v1/audio/transcriptions (padrão gpt-4o-mini-transcribe; "off" desliga)
//   AI_VISION            auto (padrão) | on | off — a IA enxerga a imagem da última mensagem do cliente

const NEGATIVE_TTL_MS = 6 * 3_600_000
const g = globalThis as unknown as { __pearchat_ai_caps?: { transcribeNoUntil: number; visionNoUntil: number } }
const caps = (g.__pearchat_ai_caps ??= { transcribeNoUntil: 0, visionNoUntil: 0 })

export const transcribeModel = () => process.env.AI_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe'
export const hasOpenAiKey = () => Boolean(process.env.OPENAI_API_KEY?.trim())
const hasAnyLlmKey = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim())

/** A transcrição de áudio pode ser tentada agora? (chave da OpenAI presente, modelo não desligado e não negado há pouco.) */
export function transcriptionAvailable(): boolean {
  if (transcribeModel().toLowerCase() === 'off') return false
  if (!hasOpenAiKey()) return false
  return Date.now() >= caps.transcribeNoUntil
}

/** O projeto da OpenAI não tem acesso ao modelo (403/404): para de tentar por algumas horas. */
export function markTranscriptionUnavailable(): void {
  caps.transcribeNoUntil = Date.now() + NEGATIVE_TTL_MS
}

/** A IA pode receber imagens? */
export function visionAvailable(): boolean {
  const mode = process.env.AI_VISION?.trim().toLowerCase() || 'auto'
  if (mode === 'off' || mode === 'false' || mode === '0') return false
  if (!hasAnyLlmKey()) return false
  return Date.now() >= caps.visionNoUntil
}

/** O modelo recusou imagem: usa só texto por 1 h (nova tentativa depois). */
export function markVisionUnavailable(): void {
  caps.visionNoUntil = Date.now() + 3_600_000
}

/** Só para testes. */
export function resetAiCaps(): void {
  caps.transcribeNoUntil = 0
  caps.visionNoUntil = 0
}
