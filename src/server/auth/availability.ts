// Sessão x banco fora do ar: o que NÃO é uma resposta do banco não pode derrubar quem está usando o app.
//
// Ao reler o usuário (espaço ativo, sessionVersion, bloqueio), há dois casos bem diferentes:
//  - RESPOSTA DEFINITIVA do banco (usuário não existe, desativado, sessionVersion diferente): a sessão acabou ('invalid').
//    APIs respondem 401 e as telas levam à "sessão encerrada".
//  - ERRO DE INFRAESTRUTURA (timeout, pool de conexões esgotado, "Can't reach database server"): NÃO invalida a sessão e NÃO
//    autoriza a ação ('unavailable'). APIs respondem 503 + Retry-After curto; as telas mostram "tente de novo" (sem apagar o
//    cookie e sem redirecionar ao login). Quando o banco volta, o mesmo cookie volta a valer.
import { NextResponse } from 'next/server'

/** Lançada por quem precisa abortar uma tela (server component) porque a sessão não pôde ser conferida agora. */
export class SessionUnavailableError extends Error {
  constructor() {
    super('session_unavailable')
    this.name = 'SessionUnavailableError'
  }
}

/** Segundos sugeridos ao cliente (Retry-After) antes de tentar de novo. */
export const RETRY_AFTER_S = 3
/** Por quanto tempo uma falha de leitura da sessão faz as respostas "sem sessão" virarem 503 em vez de 401. */
const RECENT_FAILURE_MS = 5_000

export const MSG_INSTAVEL = 'O serviço está instável no momento. Tente de novo em instantes.'

// Em globalThis: o Auth.js (src/auth.ts) e cada bundle de rota do Next são módulos distintos no mesmo processo.
const holder = globalThis as unknown as { __pearchat_session_check_failed_at?: number }

/** Registra que a releitura da sessão no banco falhou por erro de infraestrutura (chamado pelo callback `session`). */
export function markSessionCheckFailed(now: number = Date.now()): void {
  holder.__pearchat_session_check_failed_at = now
}

export function sessionCheckRecentlyFailed(now: number = Date.now()): boolean {
  const at = holder.__pearchat_session_check_failed_at
  return typeof at === 'number' && now - at < RECENT_FAILURE_MS
}

/** Zera o registro (testes). */
export function clearSessionCheckFailure(): void {
  delete holder.__pearchat_session_check_failed_at
}

/** 503 padrão das APIs quando o banco não deixou conferir a sessão: tente de novo (nada foi feito, nada foi apagado). */
export function unavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: MSG_INSTAVEL, code: 'INDISPONIVEL' },
    { status: 503, headers: { 'Retry-After': String(RETRY_AFTER_S), 'Cache-Control': 'no-store' } },
  )
}

/**
 * Resposta das rotas quando NÃO há sessão utilizável: 401 normalmente; 503 se a leitura da sessão acabou de falhar por
 * infraestrutura (a sessão não é "inválida": o banco é que não respondeu). Em ambos os casos a ação NÃO é autorizada.
 */
export function unauthorizedResponse(): NextResponse {
  return sessionCheckRecentlyFailed() ? unavailableResponse() : NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
}

type Active = { workspaceId: string; organizationId: string; papel: string; sessionVersion: number; blocked: boolean }
export type SessionVerdict<A extends Active = Active> = { kind: 'ok'; active: A } | { kind: 'invalid' } | { kind: 'unavailable'; error: unknown }

/**
 * Julga a sessão a partir do que o banco respondeu. Qualquer EXCEÇÃO ao ler é infraestrutura ('unavailable'); só uma
 * resposta do banco pode invalidar ('invalid': usuário inexistente, desativado/sem espaço liberado ou versão de sessão diferente).
 */
export async function judgeSession<A extends Active>(resolve: () => Promise<A | null>, tokenSessionVersion: number): Promise<SessionVerdict<A>> {
  let active: A | null
  try {
    active = await resolve()
  } catch (error) {
    return { kind: 'unavailable', error }
  }
  if (!active) return { kind: 'invalid' }
  if (tokenSessionVersion !== active.sessionVersion || active.blocked) return { kind: 'invalid' }
  return { kind: 'ok', active }
}
