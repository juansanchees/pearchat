import { z } from 'zod'
import { db } from '@/lib/db'
import { statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind } from '@/lib/types'
import { WhatsAppProviderError } from './provider'
import type { ContactRef, WhatsAppProvider } from './provider'
import { recipientDigits } from './phone'
import { getSession, readSessionData } from './session'

// Provedor da API Oficial (Cloud API da Meta, Graph API v23.0).
const GRAPH = 'https://graph.facebook.com/v23.0'

async function graph(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new WhatsAppProviderError('Graph API inacessível', 0, null)
  }
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // corpo não-JSON
  }
  if (!res.ok) throw new WhatsAppProviderError(`Graph API respondeu ${res.status}`, res.status, parsed)
  return parsed
}

const tokenSchema = z.object({ access_token: z.string() }).passthrough()
const sendSchema = z.object({ messages: z.array(z.object({ id: z.string() }).passthrough()).min(1) }).passthrough()

/**
 * Troca o `code` devolvido pelo Embedded Signup (FB.login) por um token de acesso do negócio.
 * No fluxo JS SDK não há redirect_uri.
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const clientId = process.env.META_APP_ID
  const clientSecret = process.env.META_APP_SECRET
  if (!clientId || !clientSecret) throw new Error('META_APP_ID/META_APP_SECRET não configurados')
  const qs = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code })
  const raw = await graph('GET', `/oauth/access_token?${qs.toString()}`, null)
  const parsed = tokenSchema.safeParse(raw)
  if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta ao trocar o code', 502, null)
  return parsed.data.access_token
}

/** Assina o app nos webhooks da WABA do cliente. */
export async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await graph('POST', `/${encodeURIComponent(wabaId)}/subscribed_apps`, token, {})
}

/** Confere que o phone_number_id informado pelo navegador pertence mesmo à WABA do token (evita reivindicar número alheio). */
export async function phoneBelongsToWaba(wabaId: string, phoneNumberId: string, token: string): Promise<boolean> {
  const raw = await graph('GET', `/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=200`, token)
  const parsed = z
    .object({ data: z.array(z.object({ id: z.string() }).passthrough()) })
    .passthrough()
    .safeParse(raw)
  return parsed.success && parsed.data.data.some((p) => p.id === phoneNumberId)
}

/** Número de exibição (ex.: "+55 11 98765-4321") de um phone_number_id, ou undefined se não der para ler. */
export async function fetchDisplayPhone(phoneNumberId: string, token: string): Promise<string | undefined> {
  try {
    const raw = await graph('GET', `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`, token)
    const parsed = z.object({ display_phone_number: z.string() }).passthrough().safeParse(raw)
    return parsed.success ? parsed.data.display_phone_number : undefined
  } catch {
    return undefined
  }
}

async function credentials(workspaceId: string): Promise<{ token: string; phoneNumberId: string }> {
  const [row, data] = await Promise.all([getSession(workspaceId), readSessionData(workspaceId)])
  const token = data.accessToken ?? process.env.META_SYSTEM_USER_TOKEN
  if (!row?.metaPhoneNumberId || !token) throw new Error('WhatsApp oficial não conectado neste workspace')
  return { token, phoneNumberId: row.metaPhoneNumberId }
}

function recipient(to: ContactRef): Record<string, string> {
  if (to.telefone) return { to: recipientDigits(to) }
  // Contato sem telefone (BSUID). Confirmar o campo na documentação vigente da Meta.
  if (to.waUserId) return { recipient: to.waUserId }
  throw new Error('Contato sem telefone nem waUserId')
}

export class CloudApiProvider implements WhatsAppProvider {
  /**
   * O Embedded Signup roda no navegador (popup do SDK JS do Facebook), então não há QR nem URL para devolver
   * aqui. A tela chama FB.login e depois POST /api/wa/embedded-signup/callback.
   */
  async connect(): Promise<{ qr?: string; signupUrl?: string }> {
    return {}
  }

  async status(workspaceId: string): Promise<ConnectionStatusKind> {
    const row = await getSession(workspaceId)
    return row ? statusToKind(row.status) : 'desconectado'
  }

  async sendText(workspaceId: string, to: ContactRef, text: string): Promise<{ providerMessageId: string }> {
    const { token, phoneNumberId } = await credentials(workspaceId)
    const raw = await graph('POST', `/${encodeURIComponent(phoneNumberId)}/messages`, token, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...recipient(to),
      type: 'text',
      text: { body: text },
    })
    const parsed = sendSchema.safeParse(raw)
    if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta', 502, null)
    return { providerMessageId: parsed.data.messages[0]!.id }
  }

  async sendTemplate(
    workspaceId: string,
    to: ContactRef,
    templateName: string,
    vars: string[],
  ): Promise<{ providerMessageId: string }> {
    const { token, phoneNumberId } = await credentials(workspaceId)
    const raw = await graph('POST', `/${encodeURIComponent(phoneNumberId)}/messages`, token, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...recipient(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components: vars.length ? [{ type: 'body', parameters: vars.map((text) => ({ type: 'text', text })) }] : [],
      },
    })
    const parsed = sendSchema.safeParse(raw)
    if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta', 502, null)
    return { providerMessageId: parsed.data.messages[0]!.id }
  }

  /** Janela de 24 h aberta: o contato mandou alguma mensagem nas últimas 24 h. */
  async canSendFreeform(workspaceId: string, contact: ContactRef): Promise<boolean> {
    const or: Array<{ waUserId: string } | { telefone: string }> = []
    if (contact.waUserId) or.push({ waUserId: contact.waUserId })
    if (contact.telefone) or.push({ telefone: contact.telefone })
    if (!or.length) return false
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const msg = await db.message.findFirst({
      where: {
        direction: 'IN',
        createdAt: { gte: since },
        conversation: { workspaceId, contact: { workspaceId, OR: or } },
      },
      select: { id: true },
    })
    return !!msg
  }

  /** Só limpa a sessão local (feito pela rota /api/wa/disconnect); a WABA continua assinada na Meta. */
  async disconnect(): Promise<void> {
    return
  }
}
