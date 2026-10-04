import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { statusToKind } from '@/lib/mappers'
import type { ConnectionStatusKind } from '@/lib/types'
import { logError } from '@/server/engine/util'
import { MAX_INBOUND_BYTES, normalizeMime } from '@/server/media/mime'
import { GraphError, graph, graphDownload, isGraphError } from './graph'
import { ProviderUnsupportedError, WhatsAppProviderError, WindowClosedError } from './provider'
import type { ContactRef, FetchedMedia, OutboundMedia, WhatsAppProvider } from './provider'
import { recipientDigits } from './phone'
import { disableAutomations, getSession, mergeSessionData, readSessionData, setStatus } from './session'
import { countTemplateVars, templateUnsupportedReason } from './template-rules'

// Provedor da API Oficial (Cloud API da Meta). Tudo passa por graph.ts (versão, appsecret_proof, retentativas).

// ---------------------------------------------------------------- Conexão (Cadastro incorporado)

const tokenSchema = z.object({ access_token: z.string() }).passthrough()

/**
 * Troca o `code` do Cadastro incorporado por um token de acesso do negócio (GET /oauth/access_token).
 * A documentação não pede redirect_uri para o code do FB.login; algumas contas só aceitam com ele (erro "redirect_uri"
 * ou 36008). Por isso tenta sem, depois com vazio e por fim com a URL do app, parando no primeiro sucesso.
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const clientId = process.env.META_APP_ID
  const clientSecret = process.env.META_APP_SECRET
  if (!clientId || !clientSecret) throw new Error('META_APP_ID/META_APP_SECRET não configurados')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || '').replace(/\/+$/, '')
  const variants: Array<string | undefined> = [undefined, '', ...(appUrl ? [`${appUrl}/`] : [])]
  let lastErr: unknown
  for (const redirect of variants) {
    try {
      const raw = await graph({
        path: '/oauth/access_token',
        query: { client_id: clientId, client_secret: clientSecret, code, ...(redirect === undefined ? {} : { redirect_uri: redirect }) },
        attempts: 2,
      })
      const parsed = tokenSchema.safeParse(raw)
      if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta ao trocar o code', 502, null)
      return parsed.data.access_token
    } catch (e) {
      lastErr = e
      // Só insiste com outro redirect_uri quando o erro é desse tipo; código inválido/expirado encerra de vez.
      const redirectIssue = isGraphError(e) && (e.subcode === 36008 || /redirect_uri/i.test(e.message))
      if (!redirectIssue) throw e
    }
  }
  throw lastErr
}

/** Assina o app nos webhooks da WABA do cliente (POST /{waba}/subscribed_apps). */
export async function subscribeApp(wabaId: string, token: string): Promise<void> {
  await graph({ method: 'POST', path: `/${encodeURIComponent(wabaId)}/subscribed_apps`, token, body: {} })
}

export type PhoneInfo = {
  id: string
  displayPhone?: string
  verifiedName?: string
  quality?: string
  status?: string
  platformType?: string
}

const phoneSchema = z
  .object({
    id: z.string(),
    display_phone_number: z.string().optional(),
    verified_name: z.string().optional(),
    quality_rating: z.string().optional(),
    status: z.string().optional(),
    platform_type: z.string().optional(),
  })
  .passthrough()

const PHONE_FIELDS = 'id,display_phone_number,verified_name,quality_rating,status,platform_type'
const toPhoneInfo = (p: z.infer<typeof phoneSchema>): PhoneInfo => ({
  id: p.id,
  ...(p.display_phone_number ? { displayPhone: p.display_phone_number } : {}),
  ...(p.verified_name ? { verifiedName: p.verified_name } : {}),
  ...(p.quality_rating ? { quality: p.quality_rating } : {}),
  ...(p.status ? { status: p.status } : {}),
  ...(p.platform_type ? { platformType: p.platform_type } : {}),
})

/** Números da WABA (GET /{waba}/phone_numbers). Também prova que o token tem acesso à WABA. */
export async function listPhoneNumbers(wabaId: string, token: string): Promise<PhoneInfo[]> {
  const raw = await graph({ path: `/${encodeURIComponent(wabaId)}/phone_numbers`, token, query: { fields: PHONE_FIELDS, limit: 200 } })
  const parsed = z.object({ data: z.array(phoneSchema) }).passthrough().safeParse(raw)
  if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta ao listar números', 502, null)
  return parsed.data.data.map(toPhoneInfo)
}

/** Dados de um número (nome exibido, nome verificado, qualidade). undefined se não der para ler. */
export async function fetchPhoneInfo(phoneNumberId: string, token: string): Promise<PhoneInfo | undefined> {
  try {
    const raw = await graph({ path: `/${encodeURIComponent(phoneNumberId)}`, token, query: { fields: PHONE_FIELDS } })
    const parsed = phoneSchema.safeParse(raw)
    return parsed.success ? toPhoneInfo(parsed.data) : undefined
  } catch (e) {
    if (isGraphError(e)) logError('meta', `leitura do número falhou (${e.toLog()})`, e)
    return undefined
  }
}

/** Registra o número na Cloud API (POST /{phone}/register). Não use em número da Coexistence (já registrado pelo app). */
export async function registerPhone(phoneNumberId: string, token: string, pin: string): Promise<void> {
  await graph({ method: 'POST', path: `/${encodeURIComponent(phoneNumberId)}/register`, token, body: { messaging_product: 'whatsapp', pin } })
}

/** PIN de verificação em duas etapas (6 dígitos) gerado pelo PearChat. */
export const newPin = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0')

/** Coexistence: pede o histórico e os contatos do app (POST /{phone}/smb_app_data); a Meta responde pelos webhooks. Janela de 24 h. */
export async function requestSmbSync(phoneNumberId: string, token: string, kinds: Array<'smb_app_state_sync' | 'history'>): Promise<void> {
  for (const sync_type of kinds) {
    await graph({ method: 'POST', path: `/${encodeURIComponent(phoneNumberId)}/smb_app_data`, token, body: { messaging_product: 'whatsapp', sync_type } })
  }
}

/** Fluxo hospedado: token do negócio do cliente a partir do token do nosso usuário do sistema (fetch_only). */
export async function fetchBusinessToken(businessId: string): Promise<string> {
  const system = process.env.META_SYSTEM_USER_TOKEN
  if (!system) throw new Error('META_SYSTEM_USER_TOKEN não configurado (necessário no cadastro hospedado pela Meta)')
  const raw = await graph({
    method: 'POST',
    path: `/${encodeURIComponent(businessId)}/system_user_access_tokens`,
    token: system,
    query: { fetch_only: 'true' },
    attempts: 2,
  })
  const parsed = tokenSchema.safeParse(raw)
  if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta ao obter o token do negócio', 502, null)
  return parsed.data.access_token
}

// ---------------------------------------------------------------- Envio

const sendSchema = z.object({ messages: z.array(z.object({ id: z.string() }).passthrough()).min(1) }).passthrough()
const idSchema = z.object({ id: z.string() }).passthrough()

type Creds = { token: string; phoneNumberId: string; wabaId: string | null }

async function credentials(workspaceId: string): Promise<Creds> {
  const [row, data] = await Promise.all([getSession(workspaceId), readSessionData(workspaceId)])
  const token = data.accessToken ?? process.env.META_SYSTEM_USER_TOKEN
  if (!row?.metaPhoneNumberId || !token) throw new Error('WhatsApp oficial não conectado neste workspace')
  return { token, phoneNumberId: row.metaPhoneNumberId, wabaId: row.metaWabaId }
}

/** Token recusado pela Meta (expirado/revogado): marca a sessão com erro e desliga as automações. */
async function handleAuthFailure(workspaceId: string, e: GraphError): Promise<void> {
  logError('meta', `token recusado (${e.toLog()})`, e)
  try {
    await setStatus(workspaceId, 'erro')
    await db.whatsAppSession.update({ where: { workspaceId }, data: { metaLastError: `Token recusado pela Meta (código ${e.code ?? e.status}). Reconecte o WhatsApp.` } })
    await disableAutomations(workspaceId)
  } catch (err) {
    logError('meta', 'falha ao marcar a sessão com erro', err)
  }
}

/** Mensagem em português para os erros de envio mais comuns da Cloud API. */
export function describeSendError(e: GraphError): string {
  const tail = ` (código ${e.code ?? e.status}${e.fbtraceId ? `, fbtrace_id ${e.fbtraceId}` : ''})`
  switch (e.code) {
    case 131026:
      return 'A mensagem não pôde ser entregue: o número não usa WhatsApp ou não pode receber' + tail
    case 131030:
      return 'Número fora da lista de destinatários permitidos (conta de teste da Meta)' + tail
    case 131042:
      return 'Forma de pagamento pendente na Meta: cadastre um pagamento no Meta Business' + tail
    case 131047:
      return 'Fora da janela de 24 h: envie um modelo aprovado' + tail
    case 131049:
      return 'A Meta não entregou esta mensagem para proteger a qualidade da conta' + tail
    case 131050:
      return 'O cliente pediu para não receber mensagens de marketing' + tail
    case 131051:
      return 'Tipo de mensagem não suportado' + tail
    case 131052:
    case 131053:
      return 'A Meta não aceitou o arquivo' + tail
    case 130429:
    case 131056:
    case 80007:
      return 'Limite de envio da Meta atingido; tente de novo em instantes' + tail
    case 132000:
    case 132012:
      return 'Variáveis do modelo não conferem com o modelo aprovado' + tail
    case 132001:
      return 'Modelo inexistente ou não aprovado na Meta' + tail
    case 132015:
    case 132016:
      return 'Modelo pausado ou desativado pela Meta' + tail
    case 133010:
      return 'Número ainda não registrado na Cloud API' + tail
    case 368:
      return 'Conta do WhatsApp restrita pela Meta' + tail
    default:
      return `${e.userMessage ?? e.message}`.slice(0, 160) + tail
  }
}

/**
 * Chamada de envio com tratamento padrão: 131047 vira WindowClosedError, token recusado derruba a sessão e 133010 (número
 * sem registro) tenta registrar uma vez com o PIN guardado e repete.
 */
async function sendCall<T>(workspaceId: string, run: (c: Creds) => Promise<T>, retriedRegister = false): Promise<T> {
  const creds = await credentials(workspaceId)
  try {
    return await run(creds)
  } catch (e) {
    if (!isGraphError(e)) throw e
    if (e.code === 131047) throw new WindowClosedError({ code: e.code, fbtraceId: e.fbtraceId })
    if (e.isAuth && e.code !== 131005) {
      await handleAuthFailure(workspaceId, e)
    } else if (e.code === 133010 && !retriedRegister) {
      const data = await readSessionData(workspaceId)
      const pin = data.pin ?? newPin()
      try {
        await registerPhone(creds.phoneNumberId, creds.token, pin)
        if (!data.pin) await db.whatsAppSession.update({ where: { workspaceId }, data: { sessionData: await mergeSessionData(workspaceId, { pin }) } })
        return await sendCall(workspaceId, run, true)
      } catch (err) {
        if (!isGraphError(err)) throw err
        throw new WhatsAppProviderError(describeSendError(err), err.status, null)
      }
    }
    throw new WhatsAppProviderError(describeSendError(e), e.status, { code: e.code, fbtraceId: e.fbtraceId })
  }
}

function recipient(to: ContactRef): Record<string, string> {
  if (to.telefone) return { to: recipientDigits(to) }
  // Contato sem telefone: BSUID no campo `recipient` (suporte de envio por BSUID previsto pela Meta para jul/2026).
  if (to.waUserId) return { recipient: to.waUserId }
  throw new Error('Contato sem telefone nem waUserId')
}

const messageBase = (to: ContactRef) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', ...recipient(to) })

async function postMessage(c: Creds, payload: Record<string, unknown>): Promise<{ providerMessageId: string }> {
  const raw = await graph({ method: 'POST', path: `/${encodeURIComponent(c.phoneNumberId)}/messages`, token: c.token, body: payload })
  const parsed = sendSchema.safeParse(raw)
  if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta', 502, null)
  return { providerMessageId: parsed.data.messages[0]!.id }
}

/** Formatos que a Cloud API aceita por tipo de mensagem (o resto vai como documento ou é recusado). */
const IMAGE_OK = new Set(['image/jpeg', 'image/png'])
const AUDIO_OK = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr'])
const VIDEO_OK = new Set(['video/mp4', 'video/3gpp'])
const LIMITS = { image: 5, audio: 16, video: 16, document: 100 } as const

async function uploadMedia(c: Creds, media: OutboundMedia, mime: string): Promise<string> {
  const form = new FormData()
  form.set('messaging_product', 'whatsapp')
  form.set('type', mime)
  form.set('file', new Blob([new Uint8Array(media.data)], { type: mime }), media.fileName)
  const raw = await graph({ method: 'POST', path: `/${encodeURIComponent(c.phoneNumberId)}/media`, token: c.token, form, timeoutMs: 90_000 })
  const parsed = idSchema.safeParse(raw)
  if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta ao enviar o arquivo', 502, null)
  return parsed.data.id
}

/** Tipo de mensagem e MIME efetivos: o que a Cloud API não aceita como imagem/vídeo segue como documento. */
function planMedia(media: OutboundMedia): { kind: 'image' | 'audio' | 'video' | 'document'; mime: string } {
  const mime = normalizeMime(media.mime)
  const mb = media.data.length / (1024 * 1024)
  if (media.type === 'image') return IMAGE_OK.has(mime) && mb <= LIMITS.image ? { kind: 'image', mime } : { kind: 'document', mime }
  if (media.type === 'video') return VIDEO_OK.has(mime) && mb <= LIMITS.video ? { kind: 'video', mime } : { kind: 'document', mime }
  if (media.type === 'audio') {
    if (!AUDIO_OK.has(mime)) {
      throw new ProviderUnsupportedError('Este formato de áudio não é aceito pela API oficial. Envie em ogg/opus, mp3, m4a ou aac.')
    }
    return { kind: 'audio', mime: mime === 'audio/ogg' ? 'audio/ogg; codecs=opus' : mime }
  }
  return { kind: 'document', mime }
}

export class CloudApiProvider implements WhatsAppProvider {
  /**
   * O Embedded Signup roda no navegador (popup do SDK JS ou link hospedado), então não há QR nem URL para devolver
   * aqui. A tela chama /api/wa/embedded-signup/start e depois /callback (SDK) ou /hosted/check (hospedado).
   */
  async connect(): Promise<{ qr?: string; signupUrl?: string }> {
    return {}
  }

  async status(workspaceId: string): Promise<ConnectionStatusKind> {
    const row = await getSession(workspaceId)
    return row ? statusToKind(row.status) : 'desconectado'
  }

  async sendText(workspaceId: string, to: ContactRef, text: string): Promise<{ providerMessageId: string }> {
    return sendCall(workspaceId, (c) => postMessage(c, { ...messageBase(to), type: 'text', text: { body: text, preview_url: false } }))
  }

  async sendMedia(workspaceId: string, to: ContactRef, media: OutboundMedia): Promise<{ providerMessageId: string }> {
    const plan = planMedia(media)
    return sendCall(workspaceId, async (c) => {
      const id = await uploadMedia(c, media, plan.mime)
      const body: Record<string, unknown> = { id }
      if (plan.kind !== 'audio' && media.caption) body.caption = media.caption
      if (plan.kind === 'document') body.filename = media.fileName
      return postMessage(c, { ...messageBase(to), type: plan.kind, [plan.kind]: body })
    })
  }

  /** Áudio: ogg/opus vira mensagem de voz no WhatsApp; os demais formatos aceitos chegam como arquivo de áudio. */
  async sendAudio(workspaceId: string, to: ContactRef, media: OutboundMedia): Promise<{ providerMessageId: string }> {
    return this.sendMedia(workspaceId, to, { ...media, type: 'audio', caption: undefined })
  }

  async sendTemplate(workspaceId: string, to: ContactRef, templateName: string, vars: string[]): Promise<{ providerMessageId: string }> {
    // Só vai modelo que existe de verdade na Meta e está aprovado (nunca um modelo "Só no PearChat").
    const tpl = await db.template.findUnique({ where: { workspaceId_name: { workspaceId, name: templateName } } })
    if (!tpl || !tpl.metaId || tpl.status !== 'APROVADO') {
      throw new WhatsAppProviderError('O modelo ainda não está aprovado na Meta', 409, null)
    }
    const unsupported = templateUnsupportedReason(tpl.components)
    if (unsupported) throw new WhatsAppProviderError(unsupported, 409, null)
    // O motor sempre manda a lista de variáveis que sabe preencher: ajusta ao tamanho exato do modelo (a Meta recusa diferença).
    const n = countTemplateVars(tpl.body)
    const params = Array.from({ length: n }, (_, i) => vars[i] ?? '')
    if (params.some((p) => !p.trim())) throw new WhatsAppProviderError('Este modelo tem variáveis que o PearChat não consegue preencher', 422, null)
    return sendCall(workspaceId, (c) =>
      postMessage(c, {
        ...messageBase(to),
        type: 'template',
        template: {
          name: tpl.name,
          language: { code: tpl.language || 'pt_BR' },
          ...(n > 0 ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text.replace(/[\r\n\t]+/g, ' ').slice(0, 1000) })) }] } : {}),
        },
      }),
    )
  }

  /** Baixa a mídia recebida: GET /{media_id} devolve uma URL temporária (5 min) que exige o token. */
  async fetchMedia(workspaceId: string, ref: { providerMessageId: string; providerMediaId?: string; maxBytes: number }): Promise<FetchedMedia> {
    if (!ref.providerMediaId) throw new WhatsAppProviderError('Mensagem sem id de mídia', 404, null)
    const creds = await credentials(workspaceId)
    try {
      const raw = await graph({ path: `/${encodeURIComponent(ref.providerMediaId)}`, token: creds.token, query: { phone_number_id: creds.phoneNumberId } })
      const parsed = z.object({ url: z.string(), mime_type: z.string().optional(), file_size: z.union([z.number(), z.string()]).optional() }).passthrough().safeParse(raw)
      if (!parsed.success) throw new WhatsAppProviderError('Resposta inesperada da Meta ao buscar a mídia', 502, null)
      if (Number(parsed.data.file_size ?? 0) > Math.min(ref.maxBytes, MAX_INBOUND_BYTES)) throw new WhatsAppProviderError('Arquivo grande demais', 413, null)
      const got = await graphDownload(parsed.data.url, creds.token, Math.min(ref.maxBytes, MAX_INBOUND_BYTES))
      return { data: got.data, mime: parsed.data.mime_type ?? got.mime }
    } catch (e) {
      if (isGraphError(e)) {
        if (e.isAuth) await handleAuthFailure(workspaceId, e)
        throw new WhatsAppProviderError('Falha ao baixar a mídia da Meta', e.status, { code: e.code })
      }
      throw e
    }
  }

  /** Janela de 24 h aberta: o contato mandou alguma mensagem (ao vivo, não importada) nas últimas 24 h. */
  async canSendFreeform(workspaceId: string, contact: ContactRef): Promise<boolean> {
    const or: Array<{ waUserId: string } | { telefone: string }> = []
    if (contact.waUserId) or.push({ waUserId: contact.waUserId })
    if (contact.telefone) or.push({ telefone: contact.telefone })
    if (!or.length) return false
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const msg = await db.message.findFirst({
      where: {
        direction: 'IN',
        imported: false,
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
