import { cpus } from 'node:os'

// Concorrência REAL do motor, dimensionada pelo pool do Prisma (connection_limit da DATABASE_URL). Cada tarefa do
// agendador e cada job de IA ocupa uma vaga; o que sobra do pool fica para as requisições HTTP e os webhooks (que nunca
// esperam vaga do motor). As vagas são divididas em duas faixas para que uma tarefa lenta (agenda do Google, importação
// de histórico, download de mídia) nunca deixe a resposta da IA sem vaga, e vice-versa.
// Estado em globalThis: o server.ts e os bundles do Next são módulos distintos no mesmo processo.

/** connection_limit efetivo da DATABASE_URL (padrão do Prisma quando ausente: núcleos * 2 + 1). */
export function connectionLimit(url = process.env.DATABASE_URL ?? ''): number {
  try {
    const n = Number(new URL(url).searchParams.get('connection_limit'))
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  } catch {
    // URL inválida: cai no padrão
  }
  return cpus().length * 2 + 1
}

/** Conexões deixadas para HTTP/webhooks (fora do motor). */
const RESERVED_FOR_HTTP = 2
const MIN_ENGINE_SLOTS = 2 // uma por faixa
const MAX_ENGINE_SLOTS = 6

/** Vagas do motor: connection_limit - 2, entre 2 e 6. ENGINE_MAX_CONCURRENCY sobrescreve (mínimo 2). */
export function engineSlots(): number {
  const forced = Number(process.env.ENGINE_MAX_CONCURRENCY)
  if (process.env.ENGINE_MAX_CONCURRENCY && Number.isFinite(forced) && forced >= 1) return Math.max(MIN_ENGINE_SLOTS, Math.floor(forced))
  return Math.max(MIN_ENGINE_SLOTS, Math.min(MAX_ENGINE_SLOTS, connectionLimit() - RESERVED_FOR_HTTP))
}

/** Faixas: `ia` = jobs de resposta da IA (metade, arredondada para cima); `tarefas` = demais tarefas do agendador. */
export type EngineLane = 'ia' | 'tarefas'

export function laneSlots(): Record<EngineLane, number> {
  const total = engineSlots()
  const ia = Math.ceil(total / 2)
  return { ia, tarefas: Math.max(1, total - ia) }
}

/** Jobs de IA em paralelo numa passada (= vagas da faixa da IA). */
export const aiConcurrency = (): number => laneSlots().ia

export class Semaphore {
  private active = 0
  private readonly queue: (() => void)[] = []
  /** Maior número de vagas ocupadas ao mesmo tempo (diagnóstico e testes). */
  peak = 0
  constructor(public readonly max: number) {}

  get inUse(): number {
    return this.active
  }
  get waiting(): number {
    return this.queue.length
  }

  async acquire(): Promise<() => void> {
    // A vaga é passada diretamente de quem solta para o próximo da fila (ver release): a contagem nunca passa de `max`.
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    else this.active++
    this.peak = Math.max(this.peak, this.active)
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

type EngineState = { limiters?: Partial<Record<EngineLane, Semaphore>>; stopping: boolean }
const g = globalThis as unknown as { __pearchat_engine_state?: EngineState }
const state = (g.__pearchat_engine_state ??= { stopping: false })

/** Semáforo de uma faixa do motor (criado na primeira chamada, com as vagas do pool). */
export function engineLimiter(lane: EngineLane): Semaphore {
  const all = (state.limiters ??= {})
  return (all[lane] ??= new Semaphore(laneSlots()[lane]))
}

/** Só para testes: recria os semáforos (ex.: depois de trocar ENGINE_MAX_CONCURRENCY/DATABASE_URL). */
export function resetEngineLimiters(): void {
  state.limiters = {}
}

/** O processo está desligando: nenhuma tarefa/job novo começa. */
export const engineStopping = (): boolean => state.stopping
export function setEngineStopping(v: boolean): void {
  state.stopping = v
}
