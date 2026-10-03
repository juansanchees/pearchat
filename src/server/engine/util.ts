import { db } from '@/lib/db'
import { providerToKind } from '@/lib/mappers'
import { spMonthKey } from '@/server/calendar/time'
import type { ProviderKind } from '@/lib/types'

// Utilitários do motor de automações. Logs do motor: só ids e contagens, nunca texto de mensagem,
// telefone nem chaves.

export const engineDisabled = () => process.env.ENGINE_DISABLED === 'true'

export function log(area: string, msg: string): void {
  console.log(`[engine:${area}] ${msg}`)
}

export function logError(area: string, msg: string, err: unknown): void {
  // Só o nome/mensagem curta do erro (os erros de provedor já vêm sem corpo).
  const detail = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'erro desconhecido'
  console.error(`[engine:${area}] ${msg} (${detail})`)
}

/** Mensagem curta de um erro, para gravar no banco (sem stack). */
export function shortError(err: unknown): string {
  return (err instanceof Error ? err.message : 'Erro desconhecido').slice(0, 200)
}

// ---- Fuso America/Sao_Paulo (UTC-3 fixo, sem horário de verão) ----

const SP_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type SpParts = { hour: number; minute: number; dow: number; ymd: string }

/** Hora, minuto, dia da semana (0 = domingo) e data de um instante, no fuso de São Paulo. */
export function spParts(d: Date): SpParts {
  const s = new Date(d.getTime() - SP_OFFSET_MS)
  return { hour: s.getUTCHours(), minute: s.getUTCMinutes(), dow: s.getUTCDay(), ymd: s.toISOString().slice(0, 10) }
}

/** Instante UTC da meia-noite (de São Paulo) do dia de `d`. */
export function spStartOfDay(d: Date): Date {
  const { ymd } = spParts(d)
  return new Date(`${ymd}T00:00:00-03:00`)
}

export const spStartOfNextDay = (d: Date): Date => new Date(spStartOfDay(d).getTime() + DAY_MS)

/** Próximo instante em que o relógio de São Paulo marca `hour`:00 (hoje, se ainda não passou). */
export function spNextHour(d: Date, hour: number): Date {
  const today = new Date(spStartOfDay(d).getTime() + hour * 3_600_000)
  return today.getTime() >= d.getTime() ? today : new Date(today.getTime() + DAY_MS)
}

export const monthKeyOf = spMonthKey

export type SilenceConfig = { disparosSilencioAtivo: boolean; disparosSilencioInicio: number; disparosSilencioFim: number }

/**
 * Horário de silêncio dos disparos (São Paulo, de hora em hora). Se `d` está dentro da janela, devolve o instante
 * em que ela termina; senão null. A janela pode cruzar a meia-noite (21→8) ou ficar no mesmo dia (13→15).
 * Início = fim não é janela.
 */
export function silenceEnd(d: Date, cfg: SilenceConfig): Date | null {
  if (!cfg.disparosSilencioAtivo) return null
  const { disparosSilencioInicio: a, disparosSilencioFim: b } = cfg
  if (a === b) return null
  const h = spParts(d).hour
  const inside = a > b ? h >= a || h < b : h >= a && h < b
  return inside ? spNextHour(d, b) : null
}

export const firstName = (nome: string): string => nome.trim().split(/\s+/)[0] ?? ''

type NameIds = { telefone?: string | null; waUserId?: string | null }

/**
 * Nome "apresentável" do contato, ou '' quando não há nome de verdade: vazio, só espaços, igual ao
 * telefone/BSUID (o ingest usa o número como nome de quem escreve sem nome), só dígitos ou o
 * "Contato" padrão. Evita mensagens como "Oi, +5511998124471!" ou "Oi, !".
 */
export function displayName(nome: string | null | undefined, ids: NameIds = {}): string {
  const n = (nome ?? '').trim().replace(/\s+/g, ' ')
  if (!n) return ''
  if (ids.telefone && n === ids.telefone.trim()) return ''
  if (ids.waUserId && n === ids.waUserId.trim()) return ''
  if (/^[+\d\s().-]+$/.test(n)) return ''
  if (n.toLowerCase() === 'contato') return ''
  return n
}

/** Primeiro nome para variáveis de modelo (sem espaço vazio): cai para "cliente". */
export const templateFirstName = (nome: string | null | undefined, ids: NameIds = {}): string =>
  firstName(displayName(nome, ids)) || 'cliente'

/**
 * Substitui {primeiro_nome} e {nome} (qualquer caixa). Sem nome utilizável, remove o marcador junto da
 * vírgula/espaço que o acompanhava ("Oi, {primeiro_nome}! Tudo bem?" -> "Oi! Tudo bem?"). Usa função de
 * troca: um nome com "$&" ou "$1" não é interpretado como padrão do replace.
 */
export function personalize(template: string, nome: string | null | undefined, ids: NameIds = {}): string {
  const full = displayName(nome, ids)
  const re = /\{(primeiro_nome|nome)\}/gi
  if (full) {
    const first = firstName(full)
    return template.replace(re, (_m, k: string) => (k.toLowerCase() === 'nome' ? full : first))
  }
  let t = template.replace(/^\s*\{(?:primeiro_nome|nome)\}[\s,;:!-]*/i, '')
  if (t !== template) t = t.charAt(0).toUpperCase() + t.slice(1)
  t = t.replace(/[ \t]*,?[ \t]*\{(?:primeiro_nome|nome)\}/gi, '')
  return t.replace(/[ \t]{2,}/g, ' ').trim()
}

/** Sem acento, minúsculo. */
export const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// ---- Conexão do WhatsApp ----

export type ConnectedSession = { workspaceId: string; kind: ProviderKind; official: boolean }

/** Sessão do WhatsApp do workspace, só se estiver CONECTADA. */
export async function getConnected(workspaceId: string): Promise<ConnectedSession | null> {
  const s = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { status: true, provider: true } })
  if (!s || s.status !== 'CONECTADO' || !s.provider) return null
  return { workspaceId, kind: providerToKind(s.provider), official: s.provider === 'OFICIAL' }
}

export async function bumpUsage(
  workspaceId: string,
  inc: { respostasIa?: number; mensagensAtendimento?: number; disparos?: number },
): Promise<void> {
  const mes = monthKeyOf()
  const data = {
    respostasIa: inc.respostasIa ?? 0,
    mensagensAtendimento: inc.mensagensAtendimento ?? 0,
    disparos: inc.disparos ?? 0,
  }
  await db.usageCounter.upsert({
    where: { workspaceId_mes: { workspaceId, mes } },
    create: { workspaceId, mes, ...data },
    update: {
      ...(data.respostasIa ? { respostasIa: { increment: data.respostasIa } } : {}),
      ...(data.mensagensAtendimento ? { mensagensAtendimento: { increment: data.mensagensAtendimento } } : {}),
      ...(data.disparos ? { disparos: { increment: data.disparos } } : {}),
    },
  })
}

/** Roda uma etapa do motor sem deixar a exceção escapar. */
export async function guarded(area: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    logError(area, 'tarefa falhou', e)
  }
}
