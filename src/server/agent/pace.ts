import type { ConnectedSession } from '@/server/engine/util'
import { getProvider } from '@/server/whatsapp'
import type { ContactRef } from '@/server/whatsapp'

// "Ritmo natural": antes de mandar a resposta da IA, mostra "digitando…" no WhatsApp do cliente (quando o provedor
// sabe fazer isso) e espera um tempo proporcional ao tamanho do texto. Não segura conexão de banco (é só um timer) e
// quem chama revalida a conversa DEPOIS da espera (se o cliente escreveu de novo, a resposta é descartada como antes).

const BASE_MS = 1_500
const PER_CHAR_MS = 35
const MAX_MS = 8_000

/** 1,5 s + 35 ms por caractere, no máximo 8 s. */
export function typingDelayMs(text: string): number {
  return Math.min(MAX_MS, BASE_MS + PER_CHAR_MS * text.trim().length)
}

/** Desligado para todos pelo ambiente (testes, operação): AI_RITMO_NATURAL=off. */
export const pacingDisabledByEnv = () => ['off', 'false', '0'].includes((process.env.AI_RITMO_NATURAL ?? '').trim().toLowerCase())

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Mostra "digitando…" e espera. Falha da presença nunca impede o envio (só vai para o log, sem dados do cliente).
 * Devolve quanto esperou (0 = ritmo desligado).
 */
export async function typingPause(opts: { session: ConnectedSession; to: ContactRef; text: string }): Promise<number> {
  if (pacingDisabledByEnv()) return 0
  const ms = typingDelayMs(opts.text)
  const provider = getProvider(opts.session.kind)
  if (provider.sendPresence) {
    // A Evolution só responde depois do `delay` (ela mesma manda "paused" no fim): não espera por ela, espera o timer.
    provider.sendPresence(opts.session.workspaceId, opts.to, { presence: 'composing', delayMs: ms }).catch((e: unknown) => {
      console.error(`[engine:ai] presença "digitando" falhou (${e instanceof Error ? e.message.slice(0, 120) : 'erro'})`)
    })
  }
  await sleep(ms)
  return ms
}
