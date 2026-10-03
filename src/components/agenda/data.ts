// Dados estáticos da Agenda (spec 05 §10) e helper de chamadas às rotas /api/calendar e /api/events.
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import type { EventOrigem, Lembrete } from '@/server/calendar/types'

export const GOOGLE_CONTAS = [
  { nome: 'Doce Ateliê', email: 'doceatelie.sp@gmail.com', sigla: 'DA' },
  { nome: 'Mariana Costa', email: 'mariana.costa@gmail.com', sigla: 'MC' },
] as const

/** Agendas do fluxo simulado; padrão marcado: pedidos e pessoal; "pedidos" é o destino. */
export const DEMO_CALS = [
  { id: 'pedidos', nome: 'Doce Ateliê · Pedidos', desc: 'Onde os novos agendamentos são criados', cor: '#a8c23a' },
  { id: 'pessoal', nome: 'Pessoal', desc: 'Só para bloquear horários ocupados', cor: '#d9a35b' },
  { id: 'feriados', nome: 'Feriados no Brasil', desc: 'Evita agendar em feriados', cor: '#5fa7a0' },
] as const
export const DEMO_DESTINO = 'pedidos'
export const DEMO_SELECIONADAS = ['pedidos', 'pessoal']
/** Cores usadas (em ciclo) para as agendas reais vindas do Google. */
export const CAL_CORES = ['#a8c23a', '#d9a35b', '#5fa7a0']

/** Durações oferecidas para cada tipo de atendimento (min). */
export const TIPO_DUR_OPTS = [15, 30, 45, 60, 90, 120, 180] as const

/** Cores predefinidas para os tipos de atendimento (barrinha lateral dos eventos manuais). */
export const TIPO_CORES = ['#a8c23a', '#d9a35b', '#5fa7a0', '#c9806b', '#8a9bd1', '#b58ac9'] as const

export const DUR_OPTS: { min: 30 | 60 | 120; label: string }[] = [
  { min: 30, label: '30 min' },
  { min: 60, label: '1 h' },
  { min: 120, label: '2 h' },
]

/** Terceiro chip: '30min' no back-end, rótulo "30 min antes". */
export const LEMBRETE_OPTS: { value: Lembrete; label: string }[] = [
  { value: '24h', label: '24 h antes' },
  { value: '2h', label: '2 h antes' },
  { value: '30min', label: '30 min antes' },
]

export const ORIGEM_BAR: Record<EventOrigem, string> = {
  IA: '#a8c23a',
  GOOGLE: '#5fa7a0',
  MANUAL: '#d9a35b',
}

export class AgendaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

/** fetch JSON; erro -> AgendaApiError com a mensagem pt-BR do back-end (`message`, senão `error`). */
export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    redirectIfUnauthorized(res.status)
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    const hasMessage = typeof data?.message === 'string'
    throw new AgendaApiError(
      res.status,
      hasMessage ? data?.error : undefined,
      (hasMessage ? data?.message : data?.error) ?? `Erro ${res.status}`,
    )
  }
  return (await res.json()) as T
}
