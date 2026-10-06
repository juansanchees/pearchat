// Ids de envios ACEITOS pelo provedor cuja gravação no banco falhou (banco fora no instante do envio). A reconciliação
// (delivery.ts) aplica o id assim que o banco voltar. Mapa com teto e validade: nunca cresce sem limite.

const TTL_MS = 60 * 60_000
const MAX = 1_000

type Entry = { providerMessageId: string; at: number }
const g = globalThis as unknown as { __pearchat_unrecorded_sends?: Map<string, Entry> }
const map = (g.__pearchat_unrecorded_sends ??= new Map<string, Entry>())

export function rememberUnrecordedSend(messageId: string, providerMessageId: string): void {
  const now = Date.now()
  for (const [k, v] of Array.from(map)) if (now - v.at > TTL_MS) map.delete(k)
  while (map.size >= MAX) {
    const first = map.keys().next().value
    if (first === undefined) break
    map.delete(first)
  }
  map.set(messageId, { providerMessageId, at: now })
}

export function takeUnrecordedSends(): [string, string][] {
  const now = Date.now()
  const out: [string, string][] = []
  for (const [k, v] of Array.from(map)) {
    if (now - v.at > TTL_MS) map.delete(k)
    else out.push([k, v.providerMessageId])
  }
  return out
}

export function forgetUnrecordedSend(messageId: string): void {
  map.delete(messageId)
}
