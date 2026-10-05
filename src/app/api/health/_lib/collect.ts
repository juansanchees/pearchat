import { readFile } from 'node:fs/promises'
import { db } from '@/lib/db'
import { DEFAULT_THRESHOLDS, evaluateCritical, type Signals, type Thresholds } from './evaluate'
import { inboxStats, withTimeout } from './shared'

// Coleta dos sinais do /api/health/check: SÓ contagens, consultas baratas, cada uma com limite de tempo e tolerante a falha
// (uma consulta que falha vira `null` = "não sei", nunca alarme falso). Resultado em cache por ~30 s.

const QUERY_TIMEOUT_MS = 3_000
const CACHE_MS = 30_000
const g = globalThis as unknown as { __pearchat_engine?: unknown; __pearchat_last_tick?: number }

const int = (name: string, def: number, min: number, max: number): number => {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}

/** Limites ajustáveis por variável (todas opcionais). */
export function thresholdsFromEnv(): Thresholds {
  const d = DEFAULT_THRESHOLDS
  return {
    jobsAtrasadosMin: int('HEALTH_CHECK_JOBS_MIN', d.jobsAtrasadosMin, 1, 1000),
    falhasEnvioMin: int('HEALTH_CHECK_SEND_FAIL_MIN', d.falhasEnvioMin, 1, 1000),
    iaRecusadasMin: int('HEALTH_CHECK_AI_REFUSED_MIN', d.iaRecusadasMin, 1, 1000),
    inboxMax: int('HEALTH_CHECK_INBOX_MAX', d.inboxMax, 1, 100000),
    inboxIdadeSeg: int('HEALTH_CHECK_INBOX_AGE_S', d.inboxIdadeSeg, 30, 86400),
    tickMaxSeg: int('HEALTH_CHECK_TICK_MAX_S', d.tickMaxSeg, 60, 3600),
    backupMaxH: int('HEALTH_CHECK_BACKUP_MAX_H', d.backupMaxH, 6, 24 * 30),
    bootGraceSeg: d.bootGraceSeg,
  }
}

async function safe<T>(p: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(p(), QUERY_TIMEOUT_MS)
  } catch {
    return null
  }
}

/** Horas desde o último backup bom, lidas do JSON mínimo que o backup.sh grava (montado somente leitura no app). */
async function backupIdadeH(): Promise<number | null> {
  const file = process.env.BACKUP_STATUS_FILE?.trim() || '/data/backup-status/backup.json'
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as { ultimoOkEpoch?: unknown }
    const ep = Number(j.ultimoOkEpoch)
    if (!Number.isFinite(ep) || ep <= 0) return null // nunca houve backup bom registrado: não alarma (backup recém-instalado)
    return Math.max(0, (Date.now() / 1000 - ep) / 3600)
  } catch {
    return null // arquivo ausente: backup não instalado ou não visível
  }
}

async function collect(): Promise<Signals> {
  const agora = Date.now()
  let dbOk = true
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, QUERY_TIMEOUT_MS)
  } catch {
    dbOk = false
  }
  const tick = g.__pearchat_last_tick
  const base = {
    dbOk,
    uptimeSeg: Math.round(process.uptime()),
    engineDisabled: /^(true|1|yes|on)$/i.test((process.env.ENGINE_DISABLED ?? '').trim()),
    engineActive: !!g.__pearchat_engine,
    tickAgeSeg: tick ? Math.round((agora - tick) / 1000) : null,
  }
  if (!dbOk) {
    return { ...base, waCaidosComIa: null, jobsAtrasados: null, falhasEnvio: null, enviosOk: null, iaRecusadas: null, inboxPendentes: null, inboxMaisAntigoSeg: null, backupIdadeH: null }
  }
  const min = (n: number) => new Date(agora - n * 60_000)
  const waMin = int('HEALTH_CHECK_WA_DOWN_MIN', 10, 1, 24 * 60) // caído há mais de X min...
  const waMaxH = int('HEALTH_CHECK_WA_MAX_H', 48, 1, 24 * 30) // ...e há menos de Y h (depois disso presume-se abandonado)
  const atrasoMin = int('HEALTH_CHECK_JOBS_AGE_MIN', 15, 5, 24 * 60)
  const [wa, ia, fu, falhas, oks, recusadas, inbox, backup] = await Promise.all([
    // WhatsApp que JÁ esteve conectado (connectedAt), caído há mais de X min e menos de Y h, em espaço com a IA LIGADA.
    safe(() =>
      db.whatsAppSession.count({
        where: {
          connectedAt: { not: null },
          status: { in: ['DESCONECTADO', 'ERRO'] },
          updatedAt: { lt: min(waMin), gt: new Date(agora - waMaxH * 3_600_000) },
          workspace: { aiAgent: { is: { enabled: true } } },
        },
      }),
    ),
    safe(() => db.aiJob.count({ where: { status: { in: ['pendente', 'executando'] }, runAt: { lt: min(atrasoMin) } } })),
    safe(() => db.followUpJob.count({ where: { status: { in: ['pendente', 'executando'] }, runAt: { lt: min(atrasoMin) } } })),
    safe(() => db.message.count({ where: { direction: 'OUT', status: 'FALHOU', createdAt: { gte: min(15) } } })),
    safe(() => db.message.count({ where: { direction: 'OUT', status: { in: ['ENVIADA', 'ENTREGUE', 'LIDA'] }, createdAt: { gte: min(15) } } })),
    safe(() =>
      db.aiJob.count({
        where: {
          status: 'erro',
          runAt: { gte: min(30) },
          OR: ['respondeu 401', 'respondeu 402', 'respondeu 403', 'respondeu 429'].map((x) => ({ error: { contains: x } })),
        },
      }),
    ),
    safe(inboxStats), // tabela ausente => { inboxTabela: 'ausente' } (sem alarme)
    backupIdadeH(),
  ])
  const inboxOk = inbox !== null && inbox.inboxTabela !== 'ausente'
  return {
    ...base,
    waCaidosComIa: wa,
    jobsAtrasados: ia === null || fu === null ? null : ia + fu,
    falhasEnvio: falhas,
    enviosOk: oks,
    iaRecusadas: recusadas,
    inboxPendentes: inboxOk ? inbox.inboxPendentes : null,
    inboxMaisAntigoSeg: inboxOk ? inbox.inboxMaisAntigoSeg : null,
    backupIdadeH: backup,
  }
}

export type CheckResult = { problems: string[]; at: number }
let cache: CheckResult | null = null
let inflight: Promise<CheckResult> | null = null

/** Resultado do /api/health/check, com cache de ~30 s (várias chamadas seguidas não multiplicam as consultas). */
export async function getCheckResult(now: number = Date.now()): Promise<CheckResult> {
  if (cache && now - cache.at < CACHE_MS) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const r: CheckResult = { problems: evaluateCritical(await collect(), thresholdsFromEnv()), at: Date.now() }
      cache = r
      return r
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Só para teste: limpa o cache. */
export function resetCheckCache(): void {
  cache = null
  inflight = null
}
