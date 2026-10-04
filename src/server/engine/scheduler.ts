import { runBillingDaily } from '@/server/billing/daily'
import { runDueAiJobs, sweepPending } from './ai-reply'
import { runCalendarSync } from './calendar-sync'
import { runDueCampaigns } from './campaigns'
import { planFollowUps, runDueFollowUps } from './followup'
import { runDueReminders } from './reminders'
import { runDueHistoryImports } from '@/server/whatsapp/history-import'
import { runDueMediaDownloads } from '@/server/media/receive'
import { runDuePhotoRefresh } from '@/server/contacts/photo'
import { runDueTranscriptions } from './transcribe'
import { engineDisabled, log, logError } from './util'

// Agendador em processo, baseado no banco (sem Redis). A cada 5 s executa as tarefas devidas.
// Cada unidade de trabalho é reivindicada com UPDATE condicional (veja os módulos), então duas
// instâncias não duplicam envios. Exceções são capturadas por tarefa: o motor nunca derruba o servidor.

const TICK_MS = 5_000

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
  ignoradas: string[]
}

const g = globalThis as unknown as { __pearchat_engine?: { timer: NodeJS.Timeout }; __pearchat_engine_running?: Set<string> }
// Trava por tarefa: um tick lento de uma tarefa não bloqueia as outras nem se sobrepõe a si mesmo.
// Fica em globalThis porque o server.ts e as rotas do Next são bundles diferentes do mesmo processo.
const running = (g.__pearchat_engine_running ??= new Set<string>())

async function task<T>(name: string, fallback: T, fn: () => Promise<T>, skipped: string[]): Promise<T> {
  if (running.has(name)) {
    skipped.push(name)
    return fallback
  }
  running.add(name)
  try {
    return await fn()
  } catch (e) {
    logError('scheduler', `tarefa ${name} falhou`, e)
    return fallback
  } finally {
    running.delete(name)
  }
}

/** Um ciclo completo. Também usado pela rota de desenvolvimento /api/dev/engine/tick. */
export async function runTick(): Promise<TickSummary> {
  const ignoradas: string[] = []
  const [ia, disparos, followup, lembretes, agenda, historico, midia, cobranca, fotos] = await Promise.all([
    task('ia', { varridas: 0, executadas: 0 }, async () => {
        // Primeiro responde o que já venceu; a varredura (mais lenta) não atrasa a resposta.
        const executadas = await runDueAiJobs()
        return { varridas: await sweepPending(), executadas }
      }, ignoradas),
    task('disparos', { enviadas: 0 }, async () => ({ enviadas: await runDueCampaigns() }), ignoradas),
    task(
      'followup',
      { planejados: 0, processados: 0 },
      async () => ({ planejados: await planFollowUps(), processados: await runDueFollowUps() }),
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
  ])
  ;(globalThis as unknown as { __pearchat_last_tick?: number }).__pearchat_last_tick = Date.now() // lido por /api/health
  return { ia, disparos, followup, lembretes, agenda, historico, midia, cobranca, fotos, ignoradas }
}

/** Inicia o laço (uma vez por processo). Desligável com ENGINE_DISABLED=true. */
export function startEngine(): void {
  if (engineDisabled()) {
    log('scheduler', 'desligado (ENGINE_DISABLED=true)')
    return
  }
  if (g.__pearchat_engine) clearInterval(g.__pearchat_engine.timer)
  const timer = setInterval(() => {
    runTick().catch((e) => logError('scheduler', 'tick falhou', e))
  }, TICK_MS)
  timer.unref()
  g.__pearchat_engine = { timer }
  log('scheduler', `iniciado (tick de ${TICK_MS / 1000}s)`)
}
