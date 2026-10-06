import { runBillingDaily } from '@/server/billing/daily'
import { drainInbox, inboxQueueIdle, pruneInbox } from '@/server/whatsapp/inbox'
import { releaseRunningAiJobs, runDueAiJobs, runningAiJobCount, sweepPending } from './ai-reply'
import { runCalendarSync } from './calendar-sync'
import { runDueCampaigns } from './campaigns'
import { reconcileUncertainSends } from './delivery'
import { planFollowUps, runDueFollowUps } from './followup'
import { engineLimiter, engineStopping, setEngineStopping } from './limiter'
import { runDueReminders } from './reminders'
import { pruneEngineHistory } from './retention'
import { runDueHistoryImports } from '@/server/whatsapp/history-import'
import { runDueMediaDownloads } from '@/server/media/receive'
import { runDuePhotoRefresh } from '@/server/contacts/photo'
import { runDueTranscriptions } from './transcribe'
import { engineDisabled, log, logError } from './util'

// Agendador em processo, baseado no banco (sem Redis). A cada 5 s executa as tarefas devidas.
// Cada unidade de trabalho é reivindicada com UPDATE condicional (veja os módulos), então duas
// instâncias não duplicam envios. Exceções são capturadas por tarefa: o motor nunca derruba o servidor.
//
// Concorrência (pool do banco): cada tarefa ocupa uma vaga da faixa "tarefas" do semáforo do motor (limiter.ts,
// dimensionado pelo connection_limit); cada job de IA ocupa uma vaga da faixa "ia" (uma tarefa lenta nunca deixa a IA
// sem vaga). Um tick NÃO se sobrepõe ao anterior: enquanto um tick está em
// andamento o próximo é pulado; uma tarefa lenta (> 60 s) deixa de segurar o tick (continua com a sua trava e o
// próximo tick a pula até ela terminar).

const TICK_MS = (() => {
  const n = Number(process.env.ENGINE_TICK_MS)
  return Number.isFinite(n) && n >= 200 ? n : 5_000
})()
/** O tick para de esperar uma tarefa depois disto (ela segue rodando, com a trava dela). */
const TASK_WATCHDOG_MS = 60_000

// Tarefas pesadas não precisam rodar a cada 5 s (M1): intervalo mínimo entre execuções.
const EVERY_MS: Record<string, number> = {
  'ia:varredura': 30_000,
  'followup:plano': 60_000,
  envios: 20_000,
  retencao: 60 * 60_000,
}

export type TickSummary = {
  ia: { varridas: number; executadas: number }
  disparos: { enviadas: number }
  followup: { planejados: number; processados: number }
  lembretes: { enviados: number }
  agenda: { sincronizadas: number }
  historico: { importacoes: number }
  midia: { downloads: number; transcricoes: number }
  cobranca: { avisos: number }
  fotos: { enfileiradas: number }
  webhooks: { reprocessados: number }
  envios: { reconciliados: number }
  ignoradas: string[]
}

type EngineGlobals = {
  __pearchat_engine?: { timer: NodeJS.Timeout }
  __pearchat_engine_running?: Set<string>
  __pearchat_engine_inflight?: Set<Promise<unknown>>
  __pearchat_engine_lastrun?: Map<string, number>
  __pearchat_engine_tick?: { inProgress: boolean; skipped: number }
}
const g = globalThis as unknown as EngineGlobals
// Trava por tarefa: uma tarefa nunca roda duas vezes ao mesmo tempo. Em globalThis porque o server.ts e as rotas do
// Next são bundles diferentes do mesmo processo.
const running = (g.__pearchat_engine_running ??= new Set<string>())
/** Tarefas em andamento (o desligamento gracioso espera por elas). */
const inflight = (g.__pearchat_engine_inflight ??= new Set<Promise<unknown>>())
const lastRun = (g.__pearchat_engine_lastrun ??= new Map<string, number>())
const tickState = (g.__pearchat_engine_tick ??= { inProgress: false, skipped: 0 })

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms)
    t.unref?.()
  })

/** A tarefa com intervalo próprio já pode rodar de novo? (marca a execução) */
function due(name: string, now = Date.now()): boolean {
  const every = EVERY_MS[name]
  if (!every) return true
  const last = lastRun.get(name) ?? 0
  if (now - last < every) return false
  lastRun.set(name, now)
  return true
}

async function task<T>(name: string, fallback: T, fn: () => Promise<T>, skipped: string[], opts: { slot?: boolean } = {}): Promise<T> {
  if (running.has(name) || engineStopping()) {
    skipped.push(name)
    return fallback
  }
  running.add(name)
  const p: Promise<T> = (async () => {
    // `slot: false`: a tarefa não ocupa vaga (os itens dela ocupam, ex.: cada job de IA).
    const release = opts.slot === false ? null : await engineLimiter('tarefas').acquire()
    try {
      return await fn()
    } finally {
      release?.()
    }
  })()
    .catch((e) => {
      logError('scheduler', `tarefa ${name} falhou`, e)
      return fallback
    })
    .finally(() => {
      running.delete(name)
      inflight.delete(p)
    })
  inflight.add(p)
  let timer: NodeJS.Timeout | undefined
  const watchdog = new Promise<T>((r) => {
    timer = setTimeout(() => {
      skipped.push(`${name}:lenta`)
      r(fallback)
    }, TASK_WATCHDOG_MS)
    timer.unref?.()
  })
  try {
    return await Promise.race([p, watchdog])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Um ciclo completo. Também usado pela rota de desenvolvimento /api/dev/engine/tick. */
export async function runTick(): Promise<TickSummary> {
  const ignoradas: string[] = []
  const [ia, disparos, followup, lembretes, agenda, historico, midia, cobranca, fotos, webhooks, envios] = await Promise.all([
    task(
      'ia',
      { varridas: 0, executadas: 0 },
      async () => {
        // Primeiro responde o que já venceu; a varredura (mais lenta, a cada 30 s) não atrasa a resposta.
        const executadas = await runDueAiJobs()
        return { varridas: due('ia:varredura') ? await sweepPending() : 0, executadas }
      },
      ignoradas,
      { slot: false },
    ),
    task('disparos', { enviadas: 0 }, async () => ({ enviadas: await runDueCampaigns() }), ignoradas),
    task(
      'followup',
      { planejados: 0, processados: 0 },
      async () => ({ planejados: due('followup:plano') ? await planFollowUps() : 0, processados: await runDueFollowUps() }),
      ignoradas,
    ),
    task('lembretes', { enviados: 0 }, async () => ({ enviados: await runDueReminders() }), ignoradas),
    // Google Agenda -> PearChat: o intervalo de 2 min por workspace é controlado dentro da tarefa.
    task('agenda', { sincronizadas: 0 }, async () => ({ sincronizadas: await runCalendarSync() }), ignoradas),
    // Histórico do WhatsApp: passagens incrementais depois de conectar (1, 3, 10 e 30 min).
    task('historico', { importacoes: 0 }, async () => ({ importacoes: await runDueHistoryImports() }), ignoradas),
    // Mídia: retoma downloads e transcrições que ficaram pendentes (servidor reiniciou no meio).
    task('midia', { downloads: 0, transcricoes: 0 }, async () => ({ downloads: await runDueMediaDownloads(), transcricoes: await runDueTranscriptions() }), ignoradas),
    // Cobrança: verificação diária (aviso de fim do teste). No-op com BILLING_ENABLED=false.
    task('cobranca', { avisos: 0 }, async () => ({ avisos: await runBillingDaily() }), ignoradas),
    // Fotos do WhatsApp dos contatos: 3 a cada 15 s (12 por minuto), em segundo plano.
    task('fotos', { enfileiradas: 0 }, async () => ({ enfileiradas: await runDuePhotoRefresh() }), ignoradas),
    // Caixa de entrada dos webhooks: o que falhou ou ficou para trás (queda/deploy) é reprocessado em ordem.
    task('webhooks', { reprocessados: 0 }, async () => ({ reprocessados: await drainInbox({ shouldStop: engineStopping }) }), ignoradas),
    // Envios sem confirmação (timeout/queda): confirma pelo provedor ou dá como falho depois do prazo. Mais retenção.
    task(
      'envios',
      { reconciliados: 0 },
      async () => {
        if (due('retencao')) await pruneHistory()
        return { reconciliados: due('envios') ? await reconcileUncertainSends() : 0 }
      },
      ignoradas,
    ),
  ])
  ;(globalThis as unknown as { __pearchat_last_tick?: number }).__pearchat_last_tick = Date.now() // lido por /api/health
  return { ia, disparos, followup, lembretes, agenda, historico, midia, cobranca, fotos, webhooks, envios, ignoradas }
}

async function pruneHistory(): Promise<void> {
  const [inbox, engine] = await Promise.all([pruneInbox(), pruneEngineHistory()])
  if (inbox + engine > 0) log('scheduler', `retenção: ${inbox} evento(s) de webhook e ${engine} registro(s) do motor apagados`)
}

/** Um tick do laço: nunca se sobrepõe ao anterior (tick lento = o próximo é pulado). */
async function guardedTick(): Promise<void> {
  if (engineStopping()) return
  if (tickState.inProgress) {
    tickState.skipped++
    if (tickState.skipped % 12 === 1) log('scheduler', `tick anterior ainda em andamento; pulado (${tickState.skipped} no total)`)
    return
  }
  tickState.inProgress = true
  try {
    await runTick()
  } catch (e) {
    logError('scheduler', 'tick falhou', e)
  } finally {
    tickState.inProgress = false
  }
}

/** Para os testes: dispara um tick do laço (com a mesma trava do intervalo). */
export const runGuardedTick = guardedTick
export const tickSkippedCount = (): number => tickState.skipped

/** Inicia o laço (uma vez por processo). Desligável com ENGINE_DISABLED=true. */
export function startEngine(): void {
  if (engineDisabled()) {
    log('scheduler', 'desligado (ENGINE_DISABLED=true)')
    return
  }
  setEngineStopping(false)
  if (g.__pearchat_engine) clearInterval(g.__pearchat_engine.timer)
  const timer = setInterval(() => void guardedTick(), TICK_MS)
  timer.unref()
  g.__pearchat_engine = { timer }
  log('scheduler', `iniciado (tick de ${TICK_MS / 1000}s, ${engineLimiter('ia').max} vaga(s) para a IA e ${engineLimiter('tarefas').max} para as tarefas)`)
}

/**
 * Desligamento gracioso: nenhum tick/tarefa/job novo começa; espera as tarefas em andamento até `graceMs`; o que não
 * terminou a tempo (jobs de IA) volta para a fila — sem duplicar envio (Message.sendKey + reconciliação).
 */
export async function stopEngine(graceMs = 25_000): Promise<{ pendentes: number; devolvidos: number }> {
  setEngineStopping(true)
  if (g.__pearchat_engine) {
    clearInterval(g.__pearchat_engine.timer)
    g.__pearchat_engine = undefined
  }
  const all = Promise.allSettled([...Array.from(inflight), inboxQueueIdle()])
  await Promise.race([all, sleep(graceMs)])
  const pendentes = inflight.size + runningAiJobCount()
  let devolvidos = 0
  try {
    devolvidos = await releaseRunningAiJobs()
  } catch (e) {
    logError('scheduler', 'devolver jobs à fila no desligamento', e)
  }
  log('scheduler', `parado (${pendentes} tarefa(s)/job(s) ainda em andamento; ${devolvidos} job(s) devolvido(s) à fila)`)
  return { pendentes, devolvidos }
}
