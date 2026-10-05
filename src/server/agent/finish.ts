import type { AgentTom } from '@/lib/types'
import type { ConnectedSession } from '@/server/engine/util'
import { HANDOFF_MODEL_NOTE } from '@/server/engine/handoff-reasons'
import type { ContactRef } from '@/server/whatsapp'
import { humanizeReply } from './humanize'
import type { ChatMessage } from './llm'
import { typingPause } from './pace'
import { HANDOFF_MARKER } from './prompt'
import { promisesTeamAction } from './promises'

// Acabamento da resposta do modelo, comum ao motor (ai-reply.ts) e ao "Testar o agente" (service.ts):
// 1) estilo (humanize.ts); 2) passagem para uma pessoa: pelo marcador, com a frase que o próprio modelo escreveu,
// ou FORÇADA quando a resposta promete ação da equipe sem o marcador (promises.ts); 3) no motor, ritmo "digitando".

/** Motivo da passagem decidida pelo modelo (mesmo texto de antes, para o painel e as notificações). */
export const MOTIVO_MODELO = 'regra de passagem (decisão da IA)'
/** Motivo da passagem forçada: a resposta prometia algo da equipe sem passar a conversa. */
export const MOTIVO_PROMESSA = 'IA prometeu ação da equipe'
export const NOTE_PROMESSA = `${HANDOFF_MODEL_NOTE} (promessa da equipe)`

export type FinishedReply =
  | { kind: 'reply'; texto: string }
  /** `message` null = usar o texto fixo de passagem do idioma. */
  | { kind: 'handoff'; motivo: string; note: string; message: string | null }

export type FinishContext = { history: ChatMessage[]; tom: AgentTom; agentName: string }

/** O que o cliente mandou desde a última resposta da IA. */
function lastCustomerText(history: ChatMessage[]): string {
  const out: string[] = []
  for (let i = history.length - 1; i >= 0 && history[i]?.role === 'user'; i--) out.unshift(history[i]?.content ?? '')
  return out.join('\n')
}

/** Texto de passagem escrito pelo modelo: só vale se for curto e sem valor em dinheiro (valor sem checagem não sai). */
function safeHandoffText(t: string): string | null {
  const s = t.trim()
  if (s.length < 4 || s.length > 400) return null
  if (/R\$|US\$|€|\$\s?\d|\d+[.,]\d{2}\b/.test(s)) return null
  return s
}

export function finishReply(raw: string, ctx: FinishContext): FinishedReply {
  const opts = {
    tom: ctx.tom,
    jaRespondeu: ctx.history.some((m) => m.role === 'assistant'),
    agentName: ctx.agentName,
    clienteTexto: lastCustomerText(ctx.history),
  }
  if (raw.includes(HANDOFF_MARKER)) {
    const sem = raw.split(HANDOFF_MARKER).join(' ').trim()
    return { kind: 'handoff', motivo: MOTIVO_MODELO, note: HANDOFF_MODEL_NOTE, message: sem ? safeHandoffText(humanizeReply(sem, opts)) : null }
  }
  const texto = humanizeReply(raw, opts)
  if (promisesTeamAction(texto)) return { kind: 'handoff', motivo: MOTIVO_PROMESSA, note: NOTE_PROMESSA, message: safeHandoffText(texto) }
  return { kind: 'reply', texto }
}

/** Motor: acabamento + (com o ritmo natural ligado) "digitando…" e pausa proporcional ao texto que vai sair. */
export async function finishAiReply(raw: string, ctx: FinishContext & { pace: { session: ConnectedSession; to: ContactRef } | null }): Promise<FinishedReply> {
  const r = finishReply(raw, ctx)
  if (ctx.pace) await typingPause({ ...ctx.pace, text: r.kind === 'reply' ? r.texto : (r.message ?? '') })
  return r
}
