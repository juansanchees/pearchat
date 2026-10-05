// Ajudantes das rotas /api/notifications: usuário e espaço SEMPRE da sessão (nada vem do cliente), limite de taxa, corpo pequeno.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { normalizePapel } from '@/server/auth/permissions'
import type { Contexto } from './sources'
import { TELAS } from './types'

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const unauthorized = () => NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
export const notFound = () => NextResponse.json({ error: 'Notificação não encontrada' }, { status: 404 })
export const badRequest = (message = 'Pedido inválido') => NextResponse.json({ error: message }, { status: 400 })

/** Respostas do sininho nunca são guardadas em cache (dependem da pessoa e do instante). */
export function json<T>(body: T, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** Usuário, espaço ativo, organização e papel da SESSÃO (o callback da sessão já confere acesso ao espaço, relendo o banco). */
export async function contextoDaSessao(): Promise<Contexto | null> {
  const session = await auth()
  const u = session?.user
  if (!u?.userId || !u.workspaceId || u.invalid) return null
  return { userId: u.userId, workspaceId: u.workspaceId, organizationId: u.organizationId ?? null, papel: normalizePapel(u.papel), email: u.email ?? null }
}

// ---- Limite de taxa (por processo, janela deslizante). O sininho faz ~2 chamadas por minuto por aba. ----
type Balde = 'sync' | 'heartbeat' | 'geral'
const LIMITES: Record<Balde, { max: number; janelaMs: number }> = {
  sync: { max: 20, janelaMs: 60_000 },
  heartbeat: { max: 10, janelaMs: 60_000 },
  geral: { max: 60, janelaMs: 60_000 },
}
const holder = globalThis as unknown as { __pearchat_notif_rl?: Map<string, number[]> }
const baldes = (holder.__pearchat_notif_rl ??= new Map())

/** Registra uma chamada e devolve 0 se pode, ou os segundos até poder de novo. */
export function limitar(userId: string, balde: Balde, agora: number = Date.now()): number {
  const { max, janelaMs } = LIMITES[balde]
  const chave = `${balde}:${userId}`
  const recentes = (baldes.get(chave) ?? []).filter((t: number) => agora - t < janelaMs)
  if (recentes.length >= max) {
    baldes.set(chave, recentes)
    return Math.max(1, Math.ceil((recentes[0] + janelaMs - agora) / 1000))
  }
  recentes.push(agora)
  baldes.set(chave, recentes)
  if (baldes.size > 5000) Array.from(baldes.entries()).forEach(([k, v]) => { if (!v.some((t: number) => agora - t < janelaMs)) baldes.delete(k) })
  return 0
}

export const tooMany = (retry: number) => json({ error: 'Muitas chamadas. Tente de novo em instantes.' }, { status: 429, headers: { 'Retry-After': String(retry) } })

const MAX_BODY = 4096

/** Corpo JSON pequeno e com content-type JSON (um formulário de outro site não consegue enviar isso). */
export async function lerCorpo(req: Request, vazioOk = false): Promise<{ ok: true; valor: unknown } | { ok: false; res: NextResponse }> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > MAX_BODY) return { ok: false, res: json({ error: 'Pedido grande demais' }, { status: 413 }) }
  const texto = await req.text().catch(() => '')
  if (texto.length > MAX_BODY) return { ok: false, res: json({ error: 'Pedido grande demais' }, { status: 413 }) }
  if (!texto.trim()) return vazioOk ? { ok: true, valor: {} } : { ok: false, res: badRequest() }
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return { ok: false, res: json({ error: 'Content-Type deve ser application/json' }, { status: 415 }) }
  try {
    return { ok: true, valor: JSON.parse(texto) as unknown }
  } catch {
    return { ok: false, res: badRequest() }
  }
}

export const syncBody = z.object({ visivel: z.boolean(), tela: z.enum(TELAS).optional() }).strict()
export const readBody = z.object({ ids: z.array(z.string().regex(ID_RE)).min(1).max(100).optional() }).strict()
export const listQuery = z.object({
  antes: z.string().max(80).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
})
