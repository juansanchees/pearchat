import { cpus } from 'node:os'

// Concorrência REAL do motor, dimensionada pelo pool do Prisma. Cada tarefa do agendador e cada job de IA ocupa uma
// vaga; o que sobra do pool fica para as requisições HTTP e os webhooks (que nunca esperam vaga do motor).
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

/** Conexões reservadas para HTTP/webhooks (fora do motor). */
const RESERVED_FOR_HTTP = 2
const MAX_ENGINE_SLOTS = 6

/** Vagas do motor: connection_limit - 2 (mínimo 1, máximo 6). ENGINE_MAX_CONCURRENCY sobrescreve. */
export function engineSlots(): number {
  const forced = Number(process.env.ENGINE_MAX_CONCURRENCY)
  if (Number.isFinite(forced) && forced >= 1) return Math.floor(forced)
  return Math.max(1, Math.min(MAX_ENGINE_SLOTS, connectionLimit() - RESERVED_FOR_HTTP))
}

/** Jobs de IA em paralelo numa passada (nunca mais que as vagas). */
export const aiConcurrency = (): number => Math.max(1, Math.min(4, engineSlots()))

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
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    this.peak = Math.max(this.peak, this.active)
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.queue.shift()?.()
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

type EngineState = { limiter?: Semaphore; stopping: boolean }
const g = globalThis as unknown as { __pearchat_engine_state?: EngineState }
const state = (g.__pearchat_engine_state ??= { stopping: false })

/** Semáforo global do motor (criado na primeira chamada, com as vagas do pool). */
export function engineLimiter(): Semaphore {
  return (state.limiter ??= new Semaphore(engineSlots()))
}

/** Só para testes: recria o semáforo (ex.: depois de trocar ENGINE_MAX_CONCURRENCY/DATABASE_URL). */
export function resetEngineLimiter(): Semaphore {
  state.limiter = new Semaphore(engineSlots())
  return state.limiter
}

/** O processo está desligando: nenhuma tarefa/job novo começa. */
export const engineStopping = (): boolean => state.stopping
export function setEngineStopping(v: boolean): void {
  state.stopping = v
}
