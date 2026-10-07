import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { addDaysStr } from '@/server/booking/availability'
import { toInstant } from '@/server/calendar/time'
import { HANDOFF_LIKE_ANY, HANDOFF_LIKE_LIMIT, HANDOFF_LIKE_RULE, HANDOFF_RULE_PREFIX_END } from '@/server/engine/handoff-reasons'
import { DEFAULT_TZ, normTz, ymdOf } from '@/lib/timezone'
import type { Periodo, ResultsDto } from './types'

// Consultas AGREGADAS no banco (nunca trazem mensagens para a memória). Dias, dias da semana e faixas do dia são do relógio
// do fuso do ESPAÇO (Workspace.timezone): `("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE <fuso>` dá a hora de parede (as
// colunas guardam o instante em UTC, sem fuso). Mensagens importadas do WhatsApp
// (imported = true) não são atendimento feito pelo app e ficam fora de TODOS os números.

const SESSION_GAP_HOURS = 6
const FOLLOWUP_WINDOW_HOURS = 48
const CACHE_TTL_MS = 60_000
// Constantes (nunca entrada do usuário) injetadas como texto SQL: evita problema de tipo ao ligar parâmetro a interval.
const GAP = Prisma.raw(`interval '${SESSION_GAP_HOURS} hours'`)
const FU_WINDOW = Prisma.raw(`interval '${FOLLOWUP_WINDOW_HOURS} hours'`)

type Num = number | bigint | null
const n = (v: Num | undefined): number => (v === null || v === undefined ? 0 : Number(v))

export function periodBounds(periodo: Periodo, now: Date = new Date(), tz: string = DEFAULT_TZ): { de: string; ate: string; from: Date; to: Date } {
  const ate = ymdOf(now, tz)
  const de = addDaysStr(ate, -(periodo - 1))
  return { de, ate, from: toInstant(de, '00:00', tz), to: toInstant(addDaysStr(ate, 1), '00:00', tz) }
}

const cache = new Map<string, { at: number; value: ResultsDto }>()
export const clearResultsCache = (): void => cache.clear()

export async function getResults(workspaceId: string, periodo: Periodo, now: Date = new Date()): Promise<ResultsDto | null> {
  const key = `${workspaceId}:${periodo}`
  const hit = cache.get(key)
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS && now.getTime() >= hit.at) return hit.value

  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { arquivadoEm: true, timezone: true } })
  if (!ws || ws.arquivadoEm) return null

  const value = await compute(workspaceId, periodo, now, normTz(ws.timezone))
  cache.set(key, { at: now.getTime(), value })
  if (cache.size > 500) for (const [k, v] of Array.from(cache)) if (now.getTime() - v.at >= CACHE_TTL_MS) cache.delete(k)
  return value
}

export async function compute(ws: string, periodo: Periodo, now: Date, tz: string = DEFAULT_TZ): Promise<ResultsDto> {
  const { de, ate, from, to } = periodBounds(periodo, now, tz)
  // Hora de parede da mensagem no fuso do espaço (o fuso vai como parâmetro, nunca como texto do SQL).
  const local = Prisma.sql`((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)`
  const lookback = new Date(from.getTime() - SESSION_GAP_HOURS * 3_600_000)

  const [tot, dias, grade, mediana, ia, motivos, ev, tipos, agSit, disp, fu] = await Promise.all([
    db.$queryRaw<{ conversas: Num; recebidas: Num; enviadas: Num }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT m."conversationId")::int AS conversas,
             (COUNT(*) FILTER (WHERE m."direction" = 'IN'))::int AS recebidas,
             (COUNT(*) FILTER (WHERE m."direction" = 'OUT'))::int AS enviadas
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."workspaceId" = ${ws} AND m."imported" = false AND m."status" <> 'FALHOU'
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}`),

    db.$queryRaw<{ dia: string; n: Num }[]>(Prisma.sql`
      SELECT to_char(${local}, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS n
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."workspaceId" = ${ws} AND m."imported" = false AND m."direction" = 'IN'
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
      GROUP BY 1`),

    db.$queryRaw<{ dow: Num; faixa: Num; n: Num }[]>(Prisma.sql`
      SELECT EXTRACT(DOW FROM ${local})::int AS dow,
             (EXTRACT(HOUR FROM ${local})::int / 6) AS faixa,
             COUNT(*)::int AS n
      FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
      WHERE c."workspaceId" = ${ws} AND m."imported" = false AND m."direction" = 'IN'
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
      GROUP BY 1, 2`),

    // Sessão = sequência de mensagens sem intervalo maior que 6 h. Tempo de resposta = da 1ª mensagem da sessão
    // (se for do cliente) até a 1ª mensagem nossa na mesma sessão. Conta a sessão que COMEÇOU no período.
    // A janela lê 6 h antes do período só para saber se a 1ª mensagem do período abre uma sessão nova.
    db.$queryRaw<{ mediana: number | null; sessoes: Num }[]>(Prisma.sql`
      WITH msgs AS (
        SELECT m."conversationId" AS cid, m."id" AS mid, m."direction" AS dir, m."createdAt" AS ts,
               LAG(m."createdAt") OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt", m."id") AS prev_ts
        FROM "Message" m JOIN "Conversation" c ON c."id" = m."conversationId"
        WHERE c."workspaceId" = ${ws} AND m."imported" = false AND m."status" <> 'FALHOU'
          AND m."createdAt" >= ${lookback} AND m."createdAt" < ${to}
      ), marked AS (
        SELECT cid, mid, dir, ts,
               SUM(CASE WHEN prev_ts IS NULL OR ts - prev_ts > ${GAP} THEN 1 ELSE 0 END)
                 OVER (PARTITION BY cid ORDER BY ts, mid) AS sess
        FROM msgs
      ), sessions AS (
        SELECT MIN(ts) AS start_ts,
               (ARRAY_AGG(dir ORDER BY ts, mid))[1] AS first_dir,
               MIN(ts) FILTER (WHERE dir = 'OUT') AS first_out
        FROM marked GROUP BY cid, sess
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_out - start_ts)))::float8 AS mediana,
             COUNT(*)::int AS sessoes
      FROM sessions
      WHERE first_dir = 'IN' AND first_out IS NOT NULL AND start_ts >= ${from} AND start_ts < ${to}`),

    // Respostas da IA = jobs concluídos sem observação (toda saída "feita" sem resposta grava uma observação).
    // Passagens = jobs concluídos com a observação de passagem/limite do plano.
    db.$queryRaw<{ respostas: Num; passagens: Num; atendidas: Num; com_passagem: Num }[]>(Prisma.sql`
      SELECT (COUNT(*) FILTER (WHERE kind = 'resp'))::int AS respostas,
             (COUNT(*) FILTER (WHERE kind = 'handoff'))::int AS passagens,
             COUNT(DISTINCT "conversationId")::int AS atendidas,
             (COUNT(DISTINCT "conversationId") FILTER (WHERE kind = 'handoff'))::int AS com_passagem
      FROM (
        SELECT j."conversationId",
               CASE WHEN j."error" IS NULL THEN 'resp'
                    WHEN j."error" LIKE ${HANDOFF_LIKE_ANY[0]} OR j."error" LIKE ${HANDOFF_LIKE_ANY[1]} THEN 'handoff' END AS kind
        FROM "AiJob" j
        WHERE j."workspaceId" = ${ws} AND j."status" = 'feito' AND j."runAt" >= ${from} AND j."runAt" < ${to}
      ) t WHERE kind IS NOT NULL`),

    db.$queryRaw<{ motivo: string; total: Num }[]>(Prisma.sql`
      SELECT CASE WHEN j."error" LIKE ${HANDOFF_LIKE_RULE} THEN substr(j."error", ${HANDOFF_RULE_PREFIX_END}::int)
                  WHEN j."error" LIKE ${HANDOFF_LIKE_LIMIT} THEN 'Limite do plano'
                  ELSE 'Decisão da IA' END AS motivo,
             COUNT(*)::int AS total
      FROM "AiJob" j
      WHERE j."workspaceId" = ${ws} AND j."status" = 'feito' AND j."runAt" >= ${from} AND j."runAt" < ${to}
        AND (j."error" LIKE ${HANDOFF_LIKE_ANY[0]} OR j."error" LIKE ${HANDOFF_LIKE_ANY[1]})
      GROUP BY 1 ORDER BY total DESC, motivo ASC`),

    db.$queryRaw<{ origem: string; total: Num }[]>(Prisma.sql`
      SELECT CASE WHEN e."canal" = 'link' THEN 'link' WHEN e."origem" = 'IA' THEN 'ia' ELSE 'manual' END AS origem,
             COUNT(*)::int AS total
      FROM "Event" e
      WHERE e."workspaceId" = ${ws} AND e."origem" <> 'GOOGLE' AND e."status" = 'ativo' AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
      GROUP BY 1`),

    db.$queryRaw<{ tipo: string; total: Num }[]>(Prisma.sql`
      SELECT COALESCE(st."nome", e."tipo") AS tipo, COUNT(*)::int AS total
      FROM "Event" e LEFT JOIN "ServiceType" st ON st."id" = e."serviceTypeId"
      WHERE e."workspaceId" = ${ws} AND e."origem" <> 'GOOGLE' AND e."status" = 'ativo' AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
      GROUP BY 1 ORDER BY total DESC, tipo ASC LIMIT 5`),

    // Situação dos agendamentos: cancelados pelo cliente, confirmados e que pediram para remarcar (resposta ao lembrete) no período.
    db.$queryRaw<{ cancelados: Num; confirmados: Num; remarcar: Num }[]>(Prisma.sql`
      SELECT (COUNT(*) FILTER (WHERE e."status" = 'cancelado' AND e."canceladoPor" = 'cliente' AND e."canceladoEm" >= ${from} AND e."canceladoEm" < ${to}))::int AS cancelados,
             (COUNT(*) FILTER (WHERE e."status" = 'ativo' AND e."confirmacao" = 'confirmado' AND e."confirmadoEm" >= ${from} AND e."confirmadoEm" < ${to}))::int AS confirmados,
             (COUNT(*) FILTER (WHERE e."status" = 'ativo' AND e."confirmacao" = 'recusado' AND e."updatedAt" >= ${from} AND e."updatedAt" < ${to}))::int AS remarcar
      FROM "Event" e
      WHERE e."workspaceId" = ${ws} AND e."origem" <> 'GOOGLE'`),

    db.$queryRaw<{ campanhas: Num; enviadas: Num; respostas: Num }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT r."campaignId")::int AS campanhas, COUNT(*)::int AS enviadas,
             COUNT(r."repliedAt")::int AS respostas
      FROM "CampaignRecipient" r JOIN "Campaign" c ON c."id" = r."campaignId"
      WHERE c."workspaceId" = ${ws} AND r."status" = 'enviado' AND r."sentAt" >= ${from} AND r."sentAt" < ${to}`),

    db.$queryRaw<{ enviados: Num; recuperados: Num; aguardando: Num }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS enviados,
             (COUNT(*) FILTER (WHERE replied))::int AS recuperados,
             (COUNT(*) FILTER (WHERE NOT replied AND j_at + ${FU_WINDOW} > ${now}))::int AS aguardando
      FROM (
        SELECT j."updatedAt" AS j_at,
               EXISTS (
                 SELECT 1 FROM "Message" m
                 WHERE m."conversationId" = j."conversationId" AND m."direction" = 'IN' AND m."imported" = false
                   AND m."createdAt" > j."updatedAt"
                   AND m."createdAt" <= j."updatedAt" + ${FU_WINDOW}
               ) AS replied
        FROM "FollowUpJob" j JOIN "Conversation" c ON c."id" = j."conversationId"
        WHERE c."workspaceId" = ${ws} AND j."status" = 'enviado' AND j."updatedAt" >= ${from} AND j."updatedAt" < ${to}
      ) t`),
  ])

  const t = tot[0]
  const porDiaMap = new Map(dias.map((d) => [d.dia, n(d.n)]))
  const porDia = Array.from({ length: periodo }, (_, i) => {
    const dia = addDaysStr(de, i)
    return { dia, recebidas: porDiaMap.get(dia) ?? 0 }
  })

  const picos = Array.from({ length: 7 }, () => [0, 0, 0, 0])
  for (const g of grade) picos[n(g.dow)][n(g.faixa)] = n(g.n)

  const m = mediana[0]
  const a = ia[0]
  const atendidas = n(a?.atendidas)
  const comPassagem = n(a?.com_passagem)

  const origem = { ia: 0, manual: 0, link: 0 }
  for (const o of ev) if (o.origem === 'ia' || o.origem === 'manual' || o.origem === 'link') origem[o.origem] = n(o.total)

  const d = disp[0]
  const dEnv = n(d?.enviadas)
  const dResp = n(d?.respostas)

  const f = fu[0]
  const fEnv = n(f?.enviados)
  const fRec = n(f?.recuperados)
  const fAg = n(f?.aguardando)
  const fBase = fEnv - fAg

  const out: ResultsDto = {
    periodo,
    de,
    ate,
    vazio: false,
    atendimento: {
      conversas: n(t?.conversas),
      recebidas: n(t?.recebidas),
      enviadas: n(t?.enviadas),
      primeiraRespostaMedianaSeg: m?.mediana === null || m?.mediana === undefined ? null : Math.round(m.mediana),
      sessoesMedidas: n(m?.sessoes),
      porDia,
    },
    ia: {
      respostas: n(a?.respostas),
      atendidas,
      semPassagemPct: atendidas > 0 ? Math.round(((atendidas - comPassagem) / atendidas) * 100) : null,
      passagens: n(a?.passagens),
      passagensPorMotivo: motivos.map((x) => ({ motivo: x.motivo, total: n(x.total) })),
    },
    agenda: {
      total: origem.ia + origem.manual + origem.link,
      porOrigem: origem,
      porTipo: tipos.map((x) => ({ tipo: x.tipo, total: n(x.total) })),
      canceladosPeloCliente: n(agSit[0]?.cancelados),
      confirmados: n(agSit[0]?.confirmados),
      pediramRemarcar: n(agSit[0]?.remarcar),
    },
    disparos: {
      campanhas: n(d?.campanhas),
      enviadas: dEnv,
      respostas: dResp,
      taxaResposta: dEnv > 0 ? Math.round((dResp / dEnv) * 100) : null,
    },
    followup: {
      enviados: fEnv,
      recuperados: fRec,
      aguardando: fAg,
      taxaRecuperacao: fBase > 0 ? Math.round((fRec / fBase) * 100) : null,
    },
    picos,
  }
  out.vazio =
    out.atendimento.conversas === 0 &&
    out.atendimento.recebidas === 0 &&
    out.atendimento.enviadas === 0 &&
    out.ia.respostas === 0 &&
    out.ia.passagens === 0 &&
    out.agenda.total === 0 &&
    out.disparos.enviadas === 0 &&
    out.followup.enviados === 0
  return out
}
