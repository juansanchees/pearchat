import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { decrypt, encrypt } from '@/server/whatsapp/crypto'
import { TZ_NAME, spToDate } from './time'

// Integração Google Agenda via fetch (sem SDK). Nunca logar tokens.

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
]
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://www.googleapis.com/calendar/v3'
const STATE_TTL_MS = 10 * 60 * 1000
const REFRESH_MARGIN_MS = 60_000
const MAX_PAGES = 4

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Código estável: 'INVALID_GRANT' (acesso revogado), 'RECONECTAR', 'SYNC_TOKEN_EXPIRADO'. */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'GoogleError'
  }
}

/** Erro que indica que o usuário precisa reconectar a conta do Google. */
export const needsReconnect = (e: unknown): boolean =>
  e instanceof GoogleError && (e.code === 'INVALID_GRANT' || e.code === 'RECONECTAR')

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET
  if (!id || !secret) throw new GoogleError('GOOGLE_NAO_CONFIGURADO')
  return { id, secret }
}

export function appBaseUrl(fallback: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || fallback).replace(/\/$/, '')
}

export function redirectUri(fallbackBase: string): string {
  return process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl(fallbackBase)}/api/calendar/google/callback`
}

// ---------- state assinado (HMAC-SHA256 com AUTH_SECRET) + nonce de uso único no banco ----------

const statePayload = z.object({ w: z.string(), n: z.string(), e: z.number() })

function stateKey(): string {
  const k = process.env.AUTH_SECRET
  if (!k) throw new GoogleError('AUTH_SECRET não configurado')
  return k
}

const sign = (data: string): Buffer => createHmac('sha256', stateKey()).update(data).digest()

/**
 * state = base64url(json{w:workspaceId,n:nonce,e:expiraEm}) + "." + base64url(hmac).
 * O nonce é gravado no banco e consumido uma única vez no callback (validade de 10 min).
 */
export async function createState(workspaceId: string, now = Date.now()): Promise<string> {
  const nonce = randomBytes(16).toString('hex')
  const expiraEm = now + STATE_TTL_MS
  await db.calendarOAuthState.deleteMany({ where: { expiraEm: { lt: new Date(now) } } })
  await db.calendarOAuthState.create({ data: { id: nonce, workspaceId, expiraEm: new Date(expiraEm) } })
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, n: nonce, e: expiraEm })).toString('base64url')
  return `${payload}.${sign(payload).toString('base64url')}`
}

/** Valida assinatura e validade; devolve { workspaceId, nonce } ou null. Não consome o nonce. */
export function verifyState(state: string, now = Date.now()): { workspaceId: string; nonce: string } | null {
  const [payload, mac, extra] = state.split('.')
  if (!payload || !mac || extra !== undefined) return null
  try {
    const given = Buffer.from(mac, 'base64url')
    const expected = sign(payload)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    const parsed = statePayload.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    if (!parsed.success || parsed.data.e < now) return null
    return { workspaceId: parsed.data.w, nonce: parsed.data.n }
  } catch {
    return null
  }
}

/** Valida o state E consome o nonce (uso único). Devolve o workspaceId ou null. */
export async function consumeState(state: string, now = Date.now()): Promise<string | null> {
  const v = verifyState(state, now)
  if (!v) return null
  const { count } = await db.calendarOAuthState.deleteMany({
    where: { id: v.nonce, workspaceId: v.workspaceId, expiraEm: { gt: new Date(now) } },
  })
  return count === 1 ? v.workspaceId : null
}

export function buildAuthUrl(state: string, fallbackBase: string): string {
  const { id } = clientCreds()
  const p = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(fallbackBase),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${p.toString()}`
}

// ---------- tokens ----------

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

const storedSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
})

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
})

async function postToken(params: Record<string, string>): Promise<z.infer<typeof tokenResponse>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    cache: 'no-store',
  })
  if (!res.ok) {
    // Só o código do erro entra na mensagem (nunca o corpo inteiro).
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null
    const code = typeof body?.error === 'string' ? body.error : undefined
    throw new GoogleError(
      `Falha na troca de token (${res.status}${code ? `, ${code}` : ''})`,
      res.status,
      code === 'invalid_grant' ? 'INVALID_GRANT' : undefined,
    )
  }
  const parsed = tokenResponse.safeParse(await res.json())
  if (!parsed.success) throw new GoogleError('Resposta de token inválida')
  return parsed.data
}

/** Troca o code por tokens. `refreshToken` vem null se o Google não o enviou (o caller decide). */
export async function exchangeCode(
  code: string,
  fallbackBase: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number }> {
  const { id, secret } = clientCreds()
  const r = await postToken({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri(fallbackBase),
    grant_type: 'authorization_code',
  })
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    expiresAt: Date.now() + r.expires_in * 1000,
  }
}

/** Troca o refresh_token por um novo access_token (não persiste). */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const { id, secret } = clientCreds()
  const r = await postToken({
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
    grant_type: 'refresh_token',
  })
  return { accessToken: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 }
}

export const encodeTokens = (t: StoredTokens): string => encrypt(JSON.stringify(t))

export function readTokens(encrypted: string): StoredTokens | null {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(decrypt(encrypted)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Revoga o token no Google (best-effort: nunca lança). */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

const refreshing = new Map<string, Promise<string>>()

async function refreshForWorkspace(workspaceId: string, tokens: StoredTokens): Promise<string> {
  try {
    const fresh = await refreshAccessToken(tokens.refreshToken)
    await db.calendarConnection.update({
      where: { workspaceId },
      data: { tokens: encodeTokens({ ...tokens, ...fresh }) },
    })
    return fresh.accessToken
  } catch (err) {
    if (err instanceof GoogleError && err.code === 'INVALID_GRANT') {
      // Acesso revogado/expirado: a tela passa a pedir "Reconectar".
      await db.calendarConnection.updateMany({ where: { workspaceId }, data: { precisaReconectar: true } })
    }
    throw err
  }
}

/** Access token válido do workspace; renova e regrava criptografado quando perto de expirar. */
export async function getValidAccessToken(workspaceId: string): Promise<string> {
  const conn = await db.calendarConnection.findUnique({
    where: { workspaceId },
    select: { tokens: true, provider: true, precisaReconectar: true },
  })
  if (!conn?.tokens || conn.provider !== 'google') throw new GoogleError('Google Agenda não conectado')
  if (conn.precisaReconectar) throw new GoogleError('Conexão com o Google expirada', 401, 'RECONECTAR')
  const tokens = readTokens(conn.tokens)
  if (!tokens) throw new GoogleError('Tokens armazenados inválidos')
  if (tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) return tokens.accessToken
  // Renovações simultâneas do mesmo workspace compartilham uma única chamada.
  let p = refreshing.get(workspaceId)
  if (!p) {
    p = refreshForWorkspace(workspaceId, tokens).finally(() => refreshing.delete(workspaceId))
    refreshing.set(workspaceId, p)
  }
  return p
}

// ---------- API do Google Calendar ----------

async function gfetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  })
}

export interface GoogleCalendar {
  id: string
  nome: string
  principal: boolean
  /** owner | writer | reader | freeBusyReader */
  papel: string
  cor: string | null
}

const calendarListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z.string().optional(),
        backgroundColor: z.string().optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
})

/** Lista as agendas com um access token já válido (usado no callback, antes de existir conexão). */
export async function listCalendarsWithToken(accessToken: string): Promise<GoogleCalendar[]> {
  const out: GoogleCalendar[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 3; page++) {
    const qs = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250' })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await gfetch(accessToken, `/users/me/calendarList?${qs.toString()}`)
    if (!res.ok) throw new GoogleError(`Falha ao listar agendas (${res.status})`, res.status)
    const parsed = calendarListSchema.safeParse(await res.json())
    if (!parsed.success) throw new GoogleError('Resposta de agendas inválida')
    for (const i of parsed.data.items) {
      out.push({
        id: i.id,
        nome: i.summaryOverride ?? i.summary ?? i.id,
        principal: i.primary === true,
        papel: i.accessRole ?? 'reader',
        cor: i.backgroundColor ?? null,
      })
    }
    pageToken = parsed.data.nextPageToken
    if (!pageToken) break
  }
  return out
}

export async function listCalendars(workspaceId: string): Promise<GoogleCalendar[]> {
  return listCalendarsWithToken(await getValidAccessToken(workspaceId))
}

export interface BusyInterval {
  start: Date
  end: Date
}

const freeBusySchema = z.object({
  calendars: z
    .record(
      z.string(),
      z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]) }),
    )
    .default({}),
})

/** Intervalos ocupados nas agendas dadas, entre timeMin e timeMax. */
export async function freeBusy(
  workspaceId: string,
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date,
): Promise<BusyInterval[]> {
  if (calendarIds.length === 0) return []
  const token = await getValidAccessToken(workspaceId)
  const res = await gfetch(token, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: TZ_NAME,
      items: calendarIds.map((id) => ({ id })),
    }),
  })
  if (!res.ok) throw new GoogleError(`Falha no free/busy (${res.status})`, res.status)
  const parsed = freeBusySchema.safeParse(await res.json())
  if (!parsed.success) throw new GoogleError('Resposta de free/busy inválida')
  return Object.values(parsed.data.calendars).flatMap((c) =>
    c.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
  )
}

// ---------- leitura de eventos (events.list) ----------

const eventTime = z.object({ dateTime: z.string().optional(), date: z.string().optional() })

const rawEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  eventType: z.string().optional(),
  start: eventTime.optional(),
  end: eventTime.optional(),
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).optional(),
})
export type RawGoogleEvent = z.infer<typeof rawEventSchema>

const eventsPageSchema = z.object({
  items: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
})

/** Evento do Google já normalizado (instantes em Date; dia inteiro à meia-noite de São Paulo, fim exclusivo). */
export interface GoogleEventRead {
  /** id do evento dentro da agenda */
  id: string
  calendarId: string
  titulo: string
  inicio: Date
  fim: Date
  diaInteiro: boolean
}

/** Converte um item de events.list. Devolve null para cancelados, recusados, sem horário ou não úteis. */
export function normalizeGoogleEvent(raw: unknown, calendarId: string): GoogleEventRead | null {
  const p = rawEventSchema.safeParse(raw)
  if (!p.success) return null
  const e = p.data
  if (e.status === 'cancelled') return null
  if (e.eventType === 'workingLocation') return null
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null
  const titulo = e.summary?.trim() || '(Sem título)'
  if (e.start?.dateTime && e.end?.dateTime) {
    const inicio = new Date(e.start.dateTime)
    const fim = new Date(e.end.dateTime)
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return null
    return { id: e.id, calendarId, titulo, inicio, fim: fim > inicio ? fim : new Date(inicio.getTime() + 60_000), diaInteiro: false }
  }
  if (e.start?.date) {
    const inicio = spToDate(e.start.date, '00:00')
    if (Number.isNaN(inicio.getTime())) return null
    let fim = e.end?.date ? spToDate(e.end.date, '00:00') : new Date(inicio.getTime() + 86_400_000)
    if (Number.isNaN(fim.getTime()) || fim <= inicio) fim = new Date(inicio.getTime() + 86_400_000)
    return { id: e.id, calendarId, titulo, inicio, fim, diaInteiro: true }
  }
  return null
}

/** Eventos de UMA agenda no intervalo (singleEvents, ordenados por início). */
export async function listCalendarEvents(
  workspaceId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleEventRead[]> {
  const token = await getValidAccessToken(workspaceId)
  const out: GoogleEventRead[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: TZ_NAME,
      maxResults: '250',
    })
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await gfetch(token, `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`)
    if (!res.ok) throw new GoogleError(`Falha ao listar eventos (${res.status})`, res.status)
    const parsed = eventsPageSchema.safeParse(await res.json())
    if (!parsed.success) throw new GoogleError('Resposta de eventos inválida')
    for (const item of parsed.data.items) {
      const ev = normalizeGoogleEvent(item, calendarId)
      if (ev) out.push(ev)
    }
    pageToken = parsed.data.nextPageToken
    if (!pageToken) break
  }
  return out
}

// ---------- sincronização incremental (syncToken) ----------

export interface SyncChange {
  id: string
  /** true = apagado/cancelado no Google */
  removido: boolean
  /** presentes quando o evento existe e tem horário */
  inicio?: Date
  fim?: Date
  diaInteiro?: boolean
}

export interface SyncResult {
  changes: SyncChange[]
  /** token para a próxima chamada; null se a listagem não terminou (não persistir) */
  nextSyncToken: string | null
  /** true = foi uma listagem completa (sem syncToken de entrada) */
  completa: boolean
  /** ids presentes na listagem (só preenchido em listagem completa) */
  presentes: Set<string> | null
}

/**
 * events.list com syncToken (incremental) ou completa (sem token). 410 com token ->
 * refaz como completa. Em listagem completa vêm só eventos não cancelados.
 */
export async function syncCalendarEvents(
  workspaceId: string,
  calendarId: string,
  syncToken: string | null,
): Promise<SyncResult> {
  const token = await getValidAccessToken(workspaceId)
  const run = async (st: string | null): Promise<SyncResult> => {
    const changes: SyncChange[] = []
    const presentes = new Set<string>()
    let pageToken: string | undefined
    let next: string | null = null
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ maxResults: '250', showDeleted: st ? 'true' : 'false' })
      if (st) qs.set('syncToken', st)
      if (pageToken) qs.set('pageToken', pageToken)
      const res = await gfetch(token, `/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`)
      if (res.status === 410 && st) throw new GoogleError('syncToken expirado', 410, 'SYNC_TOKEN_EXPIRADO')
      if (!res.ok) throw new GoogleError(`Falha na sincronização (${res.status})`, res.status)
      const parsed = eventsPageSchema.safeParse(await res.json())
      if (!parsed.success) throw new GoogleError('Resposta de sincronização inválida')
      for (const item of parsed.data.items) {
        const basic = rawEventSchema.safeParse(item)
        if (!basic.success) continue
        const ev = normalizeGoogleEvent(item, calendarId)
        if (basic.data.status === 'cancelled') {
          changes.push({ id: basic.data.id, removido: true })
        } else if (ev) {
          presentes.add(ev.id)
          changes.push({ id: ev.id, removido: false, inicio: ev.inicio, fim: ev.fim, diaInteiro: ev.diaInteiro })
        } else {
          // existe mas não é um compromisso legível (ex.: recusado): conta como presente.
          presentes.add(basic.data.id)
        }
      }
      pageToken = parsed.data.nextPageToken
      if (!pageToken) {
        next = parsed.data.nextSyncToken ?? null
        return { changes, nextSyncToken: next, completa: !st, presentes: st ? null : presentes }
      }
    }
    return { changes, nextSyncToken: null, completa: !st, presentes: null }
  }
  try {
    return await run(syncToken)
  } catch (err) {
    if (syncToken && err instanceof GoogleError && err.code === 'SYNC_TOKEN_EXPIRADO') return run(null)
    throw err
  }
}

// ---------- escrita ----------

export interface GoogleEventInput {
  titulo: string
  descricao?: string
  inicio: Date
  fim: Date
}

const eventBody = (e: GoogleEventInput) => ({
  summary: e.titulo,
  description: e.descricao ?? '',
  start: { dateTime: e.inicio.toISOString(), timeZone: TZ_NAME },
  end: { dateTime: e.fim.toISOString(), timeZone: TZ_NAME },
})

const insertedSchema = z.object({ id: z.string() })

/** Cria o evento na agenda `calendarId`; devolve o id do evento no Google. */
export async function insertEvent(
  workspaceId: string,
  calendarId: string,
  e: GoogleEventInput,
): Promise<string> {
  const token = await getValidAccessToken(workspaceId)
  const res = await gfetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({ ...eventBody(e), extendedProperties: { private: { pearchat: '1' } } }),
  })
  if (!res.ok) throw new GoogleError(`Falha ao criar evento (${res.status})`, res.status)
  const parsed = insertedSchema.safeParse(await res.json())
  if (!parsed.success) throw new GoogleError('Resposta de evento inválida')
  return parsed.data.id
}

export async function updateEvent(
  workspaceId: string,
  calendarId: string,
  googleEventId: string,
  e: GoogleEventInput,
): Promise<void> {
  const token = await getValidAccessToken(workspaceId)
  const res = await gfetch(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    { method: 'PATCH', body: JSON.stringify(eventBody(e)) },
  )
  if (!res.ok) throw new GoogleError(`Falha ao atualizar evento (${res.status})`, res.status)
}

/** Remove o evento; 404/410 (já removido) contam como sucesso. */
export async function deleteEvent(
  workspaceId: string,
  calendarId: string,
  googleEventId: string,
): Promise<void> {
  const token = await getValidAccessToken(workspaceId)
  const res = await gfetch(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new GoogleError(`Falha ao remover evento (${res.status})`, res.status)
  }
}
