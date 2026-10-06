import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { inboxStats } from '@/server/whatsapp/inbox'

export const dynamic = 'force-dynamic'

// Saúde do app para o monitor da VPS. Pública (liberada no middleware) e sem dados sensíveis.
// Com o header x-health-token == HEALTH_TOKEN devolve também detalhes do motor e do WhatsApp
// (apenas contagens, nunca números de telefone).
const HEADERS = { 'Cache-Control': 'no-store' }
const DB_TIMEOUT_MS = 3_000
const STUCK_MIN = 10

const g = globalThis as unknown as { __pearchat_engine?: unknown; __pearchat_last_tick?: number }

function version(): string {
  try {
    const v = readFileSync(join(process.cwd(), '.deploy-commit'), 'utf8').trim()
    if (/^[0-9a-f]{7,40}$/i.test(v)) return v.slice(0, 12)
  } catch {
    // arquivo ausente (dev ou build sem commit)
  }
  return process.env.npm_package_version ?? 'dev'
}

function tokenOk(req: Request): boolean {
  const expected = process.env.HEALTH_TOKEN
  const given = req.headers.get('x-health-token')
  if (!expected || !given) return false
  // Compara os hashes (tamanho fixo) em tempo constante.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('timeout')), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

export async function GET(req: Request) {
  let dbOk = true
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, DB_TIMEOUT_MS)
  } catch {
    dbOk = false
  }
  const body: Record<string, unknown> = {
    ok: dbOk,
    db: dbOk ? 'ok' : 'erro',
    versao: version(),
    uptimeSeg: Math.round(process.uptime()),
  }

  if (tokenOk(req)) {
    const agora = Date.now()
    const tick = g.__pearchat_last_tick
    body.agendador = {
      ativo: !!g.__pearchat_engine,
      ultimoTick: tick ? new Date(tick).toISOString() : null,
      idadeTickSeg: tick ? Math.round((agora - tick) / 1000) : null,
    }
    if (dbOk) {
      try {
        const limite = new Date(agora - STUCK_MIN * 60_000)
        const [ia, followUp, wa, caixa] = await withTimeout(
          Promise.all([
            db.aiJob.count({ where: { status: { in: ['pendente', 'executando'] }, runAt: { lt: limite } } }),
            db.followUpJob.count({ where: { status: { in: ['pendente', 'executando'] }, runAt: { lt: limite } } }),
            db.whatsAppSession.groupBy({ by: ['status'], _count: { _all: true } }),
            inboxStats(),
          ]),
          DB_TIMEOUT_MS,
        )
        const total = wa.reduce((n, r) => n + r._count._all, 0)
        const conectados = wa.filter((r) => r.status === 'CONECTADO').reduce((n, r) => n + r._count._all, 0)
        body.jobsPresos = { ia, followUp, soma: ia + followUp, acimaDeMin: STUCK_MIN }
        body.whatsapp = { conectados, desconectados: total - conectados, total }
        // Caixa de entrada dos webhooks (só contagens): pendentes, desistidas e idade da mais antiga pendente.
        body.caixaEntrada = caixa
      } catch {
        body.detalhes = 'erro'
      }
    }
  }

  return NextResponse.json(body, { status: dbOk ? 200 : 503, headers: HEADERS })
}
