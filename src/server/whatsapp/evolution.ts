import { z } from 'zod'
import type { ConnectionStatusKind } from '@/lib/types'
import { onlyDigits, recipientDigits, toE164 } from './phone'
import { WhatsAppProviderError } from './provider'
import type { ContactRef, WhatsAppProvider } from './provider'

// Provedor "conexão rápida": Evolution API 2.3.7 (Baileys / WhatsApp Web), via REST.

export const instanceNameFor = (workspaceId: string) => `pc_${workspaceId}`

const WEBHOOK_EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONTACTS_UPSERT']

function baseUrl(): string {
  const url = process.env.EVOLUTION_API_URL
  if (!url) throw new Error('EVOLUTION_API_URL não configurada')
  return url.replace(/\/+$/, '')
}

function webhookUrl(): string {
  const explicit = process.env.EVOLUTION_WEBHOOK_URL
  if (explicit) return explicit
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${app}/api/wa/evolution`
}

async function evo(method: string, path: string, body?: unknown): Promise<unknown> {
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!apiKey) throw new Error('EVOLUTION_API_KEY não configurada')
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new WhatsAppProviderError('Evolution API inacessível', 0, null)
  }
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // corpo não-JSON: mantém o texto
  }
  if (!res.ok) throw new WhatsAppProviderError(`Evolution API respondeu ${res.status}`, res.status, parsed)
  return parsed
}

const stateSchema = z.object({ instance: z.object({ state: z.string() }).passthrough() }).passthrough()
const qrSchema = z.object({ base64: z.string().optional(), code: z.string().optional() }).passthrough()
const sendSchema = z.object({ key: z.object({ id: z.string() }).passthrough() }).passthrough()

export function mapEvolutionState(state: string): ConnectionStatusKind {
  switch (state) {
    case 'open':
      return 'conectado'
    case 'connecting':
      return 'conectando'
    default:
      return 'desconectado'
  }
}

export class EvolutionProvider implements WhatsAppProvider {
  private async getState(instance: string): Promise<ConnectionStatusKind | null> {
    try {
      const raw = await evo('GET', `/instance/connectionState/${encodeURIComponent(instance)}`)
      const parsed = stateSchema.safeParse(raw)
      return parsed.success ? mapEvolutionState(parsed.data.instance.state) : 'desconectado'
    } catch (e) {
      if (e instanceof WhatsAppProviderError && e.status === 404) return null
      throw e
    }
  }

  private async ensureInstance(workspaceId: string): Promise<ConnectionStatusKind> {
    const instance = instanceNameFor(workspaceId)
    const current = await this.getState(instance)
    if (current) return current
    try {
      await evo('POST', '/instance/create', {
        instanceName: instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          url: webhookUrl(),
          byEvents: false,
          base64: false,
          headers: { apikey: process.env.EVOLUTION_API_KEY ?? '' },
          events: WEBHOOK_EVENTS,
        },
      })
    } catch (e) {
      // Corrida entre duas chamadas: a instância já foi criada pela outra.
      const dup = e instanceof WhatsAppProviderError && (e.status === 403 || e.status === 409)
      if (!dup) throw e
    }
    return 'conectando'
  }

  async refreshQr(workspaceId: string): Promise<string | undefined> {
    const raw = await evo('GET', `/instance/connect/${encodeURIComponent(instanceNameFor(workspaceId))}`)
    const parsed = qrSchema.safeParse(raw)
    return parsed.success ? parsed.data.base64 : undefined
  }

  async connect(workspaceId: string): Promise<{ qr?: string }> {
    const state = await this.ensureInstance(workspaceId)
    if (state === 'conectado') return {}
    const qr = await this.refreshQr(workspaceId)
    return qr ? { qr } : {}
  }

  async status(workspaceId: string): Promise<ConnectionStatusKind> {
    return (await this.getState(instanceNameFor(workspaceId))) ?? 'desconectado'
  }

  /** Número da instância conectada, em E.164 (campo `ownerJid` de fetchInstances). */
  async fetchNumero(workspaceId: string): Promise<string | undefined> {
    const raw = await evo('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceNameFor(workspaceId))}`)
    const first: unknown = Array.isArray(raw) ? raw[0] : raw
    if (!first || typeof first !== 'object') return undefined
    const o = first as { ownerJid?: unknown; number?: unknown; instance?: { owner?: unknown } }
    const jid = [o.ownerJid, o.number, o.instance?.owner].find((v): v is string => typeof v === 'string' && v.length > 0)
    if (!jid) return undefined
    const digits = onlyDigits(jid.split('@')[0] ?? '')
    return digits.length >= 10 ? toE164(digits) : undefined
  }

  async sendText(workspaceId: string, to: ContactRef, text: string): Promise<{ providerMessageId: string }> {
    const raw = await evo('POST', `/message/sendText/${encodeURIComponent(instanceNameFor(workspaceId))}`, {
      number: recipientDigits(to),
      text,
    })
    const parsed = sendSchema.safeParse(raw)
    if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Evolution', 502, null)
    return { providerMessageId: parsed.data.key.id }
  }

  async canSendFreeform(): Promise<boolean> {
    return true
  }

  async disconnect(workspaceId: string): Promise<void> {
    try {
      await evo('DELETE', `/instance/logout/${encodeURIComponent(instanceNameFor(workspaceId))}`)
    } catch (e) {
      // Já deslogada ou instância inexistente: o objetivo está cumprido.
      if (e instanceof WhatsAppProviderError && (e.status === 404 || e.status === 400)) return
      throw e
    }
  }
}
