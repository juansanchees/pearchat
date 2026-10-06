import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { inboxStats, tokenMatches, withTimeout } from './_lib/shared'

export const dynamic = 'force-dynamic'

// Saúde do app. PÚBLICA (liberada no middleware): sem token devolve só { ok, db } (nada de versão, uptime ou contagens).
// Com o header x-health-token == HEALTH_TOKEN devolve também versão, agendador, filas, WhatsApp e erros recentes de IA:
// SÓ contagens e idades, nunca telefone, nome, texto de mensagem nem identificadores. Consultas baratas, cada uma com
// limite de tempo; qualquer uma que falhe vira `detalhes: "erro"` sem derrubar a resposta.
// Quem lê: deploy/monitor/check.sh (a cada 5 min, na própria VPS) e deploy/lib-remote.sh (verificação pós-deploy).
// Monitor EXTERNO (UptimeRobot etc.): use /api/health SEM token e confira só o código HTTP (200 = ok, 503 = banco fora).
const HEADERS = { 'Cache-Control': 'no-store' }
const DB_TIMEOUT_MS = 3_000
const STUCK_MIN = 10
const SEND_FAIL_WINDOW_MIN = 15
const AI_ERROR_WINDOW_MIN = 30
/** Minutos sem conexão para contar um WhatsApp como "desconectado há muito tempo" (sobrescreve com HEALTH_WA_DOWN_MIN). */
const WA_DOWN_MIN_DEFAULT = 30

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

function waDownMinutes(): number {
  const n = Number(process.env.HEALTH_WA_DOWN_MIN)
  return Number.isInteger(n) && n >= 1 && n <= 24 * 60 ? n : WA_DOWN_MIN_DEFAULT
}

export async function GET(req: Request) {
  let dbOk = true
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, DB_TIMEOUT_MS)
  } catch {
    dbOk = false
  }
  const body: Record<string, unknown> = { ok: dbOk, db: dbOk ? 'ok' : 'erro' }

  if (tokenMatches(req.headers.get('x-health-token'))) {
    const agora = Date.now()
    const tick = g.__pearchat_last_tick
    body.versao = version()
    body.uptimeSeg = Math.round(process.uptime())
    body.agendador = {
      ativo: !!g.__pearchat_engine,
      ultimoTick: tick ? new Date(tick).toISOString() : null,
      idadeTickSeg: tick ? Math.round((agora - tick) / 1000) : null,
    }
    if (dbOk) {
      try {
        const limite = new Date(agora - STUCK_MIN * 60_000)
        const waLimite = new Date(agora - waDownMinutes() * 60_000)
        const envioDesde = new Date(agora - SEND_FAIL_WINDOW_MIN * 60_000)
        const iaDesde = new Date(agora - AI_ERROR_WINDOW_MIN * 60_000)
        const [ia, followUp, wa, pendIa, pendFollow, waLongos, falhasEnvio, iaCredito] = await withTimeout(
          Promise.all([
            db.aiJob.count({ where: { status: { in: ['pendente', 'executando'] }, runAt: { lt: limite } } }),
            db.followUpJob.count({ where: { status: { in: ['pendente', 'executando'] }, runAt: { lt: limite } } }),
            db.whatsAppSession.groupBy({ by: ['status'], _count: { _all: true } }),
            db.aiJob.count({ where: { status: 'pendente' } }),
            db.followUpJob.count({ where: { status: 'pendente' } }),
            // Já esteve conectado alguma vez (connectedAt) e agora está caído há mais de X minutos. Só contagem.
            db.whatsAppSession.count({ where: { connectedAt: { not: null }, status: { in: ['DESCONECTADO', 'ERRO'] }, updatedAt: { lt: waLimite } } }),
            // Falhas de envio na janela (sem ler conteúdo). Sem índice por data: ok com o volume atual; se a tabela
            // crescer muito, criar índice em Message(createdAt) numa migração aditiva.
            db.message.count({ where: { status: 'FALHOU', direction: 'OUT', createdAt: { gte: envioDesde } } }),
            // Erro de crédito/chave do provedor de IA (HTTP 401/402/403/429 gravado em AiJob.error por llm.ts).
            db.aiJob.count({
              where: {
                status: 'erro',
                runAt: { gte: iaDesde },
                OR: ['respondeu 401', 'respondeu 402', 'respondeu 403', 'respondeu 429'].map((t) => ({ error: { contains: t } })),
              },
            }),
          ]),
          DB_TIMEOUT_MS,
        )
        const total = wa.reduce((n, r) => n + r._count._all, 0)
        const conectados = wa.filter((r) => r.status === 'CONECTADO').reduce((n, r) => n + r._count._all, 0)
        body.jobsPresos = { ia, followUp, soma: ia + followUp, acimaDeMin: STUCK_MIN }
        body.whatsapp = { conectados, desconectados: total - conectados, total }
        body.filas = { pendentesIa: pendIa, pendentesFollowUp: pendFollow }
        body.alertas = {
          waDesconectadosLongos: waLongos,
          waLimiteMin: waDownMinutes(),
          falhasEnvio15min: falhasEnvio,
          iaErroCredito30min: iaCredito,
        }
      } catch {
        body.detalhes = 'erro'
      }
      try {
        Object.assign(body, await withTimeout(inboxStats(), DB_TIMEOUT_MS))
      } catch {
        body.inboxTabela = 'erro'
      }
    }
  }

  return NextResponse.json(body, { status: dbOk ? 200 : 503, headers: HEADERS })
}
