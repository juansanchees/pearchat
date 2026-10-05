// Sininho: sincronização, histórico, leitura e apagamento. As notificações são DERIVADAS do que já está gravado
// (ver sources.ts) quando o cliente pede; nada aqui é chamado pelo motor, pela ingestão ou pelo envio.
//
// Garantias:
//  - idempotente e seguro com duas abas: quem avança o cursor (compare-and-set) é o único que grava; chaves únicas por
//    (usuário, espaço, dedupeKey) cobrem o resto;
//  - tudo é filtrado por usuário E espaço vindos da sessão (nunca do cliente);
//  - apagar zera o conteúdo e deixa só a marca (chave), então o que foi apagado não volta; o cursor nunca recua;
//  - retenção: 7 dias (leitura filtra, e uma limpeza preguiçosa apaga de verdade).
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { totalDe, textoAgregado, resumoAusente } from './format'
import type { AgregadoEstado } from './format'
import { coletar, linkConversa, LINK_FILTRO_IA, LINK_FILTRO_NAO_LIDAS, sondar } from './sources'
import type { AggFato, AggTipo, Contexto, Estado, UnicoFato } from './sources'
import {
  AUSENTE_MS,
  ITENS_PAGINA,
  ITENS_SYNC,
  JANELA_SOMA_MS,
  MIN_VARREDURA_MS,
  PRIMEIRA_JANELA_MS,
  RETENCAO_MS,
  SETTLE_MS,
} from './types'
import type { ListResponse, NotifDados, NotificationDTO, NotifTipo, SyncResponse, Tela } from './types'

export type { Contexto } from './sources'

const CAP_IDS = 200
const CAP_UNICOS = 40

/** Tipos que a pessoa já "viu ao vivo" estando na tela correspondente: nascem lidos (continuam no histórico). */
const VISTO_AO_VIVO: Record<Tela, readonly NotifTipo[]> = {
  conversas: ['ia_respondeu', 'nova_conversa', 'followup'],
  agenda: ['agenda_novo', 'agenda_remarcado', 'agenda_cancelado', 'agenda_confirmado', 'agenda_remarcar'],
  contatos: [],
  outra: [],
}

const ALTA: ReadonlySet<string> = new Set(['passou_para_voce', 'whatsapp_desconectou'])

export function toDTO(r: {
  id: string
  tipo: string
  titulo: string
  corpo: string | null
  contagem: number
  link: string | null
  ausente: boolean
  ocorridoEm: Date
  lidaEm: Date | null
  dados: Prisma.JsonValue
}): NotificationDTO {
  const dados = r.dados && typeof r.dados === 'object' && !Array.isArray(r.dados) ? (r.dados as NotifDados) : null
  return {
    id: r.id,
    tipo: r.tipo,
    titulo: r.titulo,
    corpo: r.corpo,
    contagem: r.contagem,
    link: r.link,
    ausente: r.ausente,
    prioridade: ALTA.has(r.tipo) || (r.tipo === 'cota_ia' && dados?.nivel === 100) ? 'alta' : 'normal',
    ocorridoEm: r.ocorridoEm.toISOString(),
    lida: r.lidaEm !== null,
    dados,
  }
}

const SELECT_DTO = { id: true, tipo: true, titulo: true, corpo: true, contagem: true, link: true, ausente: true, ocorridoEm: true, lidaEm: true, dados: true } as const

const corte = (now: Date) => new Date(now.getTime() - RETENCAO_MS)

// ---------------------------------------------------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------------------------------------------------

function estadoVazio(): AgregadoEstado {
  return { ids: [], nomes: [], motivos: {}, extra: 0 }
}

function lerEstado(v: Prisma.JsonValue | null | undefined): AgregadoEstado {
  const e = estadoVazio()
  if (!v || typeof v !== 'object' || Array.isArray(v)) return e
  const o = v as Record<string, unknown>
  if (Array.isArray(o.ids)) e.ids = o.ids.filter((x): x is string => typeof x === 'string').slice(0, CAP_IDS)
  if (Array.isArray(o.nomes)) e.nomes = o.nomes.filter((x): x is string => typeof x === 'string').slice(0, 3)
  if (o.motivos && typeof o.motivos === 'object' && !Array.isArray(o.motivos)) {
    for (const [k, n] of Object.entries(o.motivos as Record<string, unknown>).slice(0, 5)) if (typeof n === 'number') e.motivos[k] = n
  }
  if (typeof o.extra === 'number') e.extra = o.extra
  return e
}

/** Soma itens novos ao estado (cada id conta uma vez). Devolve quantos eram novos. */
function somar(est: AgregadoEstado, fatos: AggFato[]): number {
  const vistos = new Set(est.ids)
  let novos = 0
  for (const f of fatos) {
    if (vistos.has(f.id)) continue
    novos++
    if (est.ids.length < CAP_IDS) {
      est.ids.push(f.id)
      vistos.add(f.id)
    } else {
      est.extra++
    }
    if (f.nome && est.nomes.length < 3 && !est.nomes.includes(f.nome)) est.nomes.push(f.nome)
    if (f.motivo && (f.motivo in est.motivos || Object.keys(est.motivos).length < 5)) est.motivos[f.motivo] = (est.motivos[f.motivo] ?? 0) + 1
  }
  return novos
}

function linkAgregado(tipo: AggTipo, est: AgregadoEstado): string | null {
  const unica = totalDe(est) === 1 ? est.ids[0] : undefined
  switch (tipo) {
    case 'ia_respondeu':
      return unica ? linkConversa(unica) : LINK_FILTRO_IA
    case 'passou_para_voce':
    case 'esperando_resposta':
      return unica ? linkConversa(unica) : LINK_FILTRO_NAO_LIDAS
    case 'nova_conversa':
    case 'followup':
      return unica ? linkConversa(unica) : '/whatsapp'
    case 'falha_envio':
      return '/whatsapp'
    default:
      return '/agenda'
  }
}

const iso = (d: Date) => d.toISOString()
const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b)

type Grupo = { tipo: AggTipo; ausente: boolean; fatos: AggFato[] }

function agrupar(agg: AggFato[], ehAusente: (at: Date) => boolean): Grupo[] {
  const m = new Map<string, Grupo>()
  for (const f of agg) {
    const ausente = ehAusente(f.at)
    const k = `${f.tipo}|${ausente ? 'a' : 'p'}`
    const g = m.get(k) ?? { tipo: f.tipo, ausente, fatos: [] }
    g.fatos.push(f)
    m.set(k, g)
  }
  return Array.from(m.values())
}

// ---------------------------------------------------------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------------------------------------------------------

export type SyncInput = {
  /** A aba está visível E em foco: conta como presença. */
  visivel: boolean
  /** Dica da tela atual (valida contra a lista; serve só para marcar como lido o que a pessoa vê ao vivo). */
  tela?: Tela
  /** Relógio injetável (testes). */
  now?: Date
}

export async function syncNotifications(ctx: Contexto, input: SyncInput): Promise<SyncResponse> {
  const now = input.now ?? new Date()
  const { userId, workspaceId } = ctx
  const cursor = await db.notificationCursor.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } })

  const since = cursor ? new Date(Math.max(cursor.sincronizadoAte.getTime(), now.getTime() - RETENCAO_MS)) : new Date(now.getTime() - PRIMEIRA_JANELA_MS)
  let upTo = new Date(now.getTime() - SETTLE_MS)
  // Presença: o batimento mais recente. Primeira sincronização não é "volta".
  const prevAtividade = cursor ? cursor.ultimaAtividadeEm : now
  const away = cursor ? now.getTime() - prevAtividade.getTime() > AUSENTE_MS : false
  const estadoAtual: Estado = (cursor?.estado && typeof cursor.estado === 'object' && !Array.isArray(cursor.estado) ? (cursor.estado as Estado) : {}) ?? {}

  let resumo: string | null = null
  const presenca = input.visivel ? now : prevAtividade

  if (!cursor || upTo.getTime() - since.getTime() >= MIN_VARREDURA_MS) {
    const sond = await sondar(ctx, { since, upTo })
    if (sond.seguraAte) upTo = new Date(Math.min(upTo.getTime(), sond.seguraAte.getTime() - 1)) // resposta da IA em andamento: espera terminar
    if (upTo.getTime() > since.getTime()) {
      const algo = sond.conv || sond.ia || sond.fu || sond.ev || sond.wa || sond.camp || sond.inv || estadoAtual.wa === undefined
      const col = algo ? await coletar(ctx, { since, upTo }, sond, estadoAtual) : { agg: [], unicos: [], estado: estadoAtual }
      const r = await gravar({ ctx, cursor, since, upTo, now, prevAtividade, away, visivel: input.visivel, tela: input.tela ?? 'outra', col, presenca })
      resumo = r
    } else if (input.visivel) {
      await baterPresenca(userId, workspaceId, now)
    }
  } else if (input.visivel) {
    await baterPresenca(userId, workspaceId, now)
  }

  await purgeExpired(now)
  const { itens, naoLidas } = await lerLista(userId, workspaceId, now, ITENS_SYNC)
  return { naoLidas, itens, ausenteDesde: away ? iso(prevAtividade) : null, resumoAusente: resumo }
}

async function baterPresenca(userId: string, workspaceId: string, now: Date): Promise<void> {
  await db.notificationCursor.updateMany({ where: { userId, workspaceId, ultimaAtividadeEm: { lt: now } }, data: { ultimaAtividadeEm: now } })
}

type GravarArgs = {
  ctx: Contexto
  cursor: { sincronizadoAte: Date } | null
  since: Date
  upTo: Date
  now: Date
  prevAtividade: Date
  away: boolean
  visivel: boolean
  tela: Tela
  col: { agg: AggFato[]; unicos: UnicoFato[]; estado: Estado }
  presenca: Date
}

/** Avança o cursor (único ponto de "posse" da janela) e grava os itens. Devolve o resumo "enquanto você esteve fora", se houver. */
async function gravar(a: GravarArgs): Promise<string | null> {
  const { userId, workspaceId } = a.ctx
  const ehAusente = (at: Date) => a.away && at.getTime() > a.prevAtividade.getTime()
  const lerAoVivo = a.visivel ? new Set<NotifTipo>(VISTO_AO_VIVO[a.tela]) : new Set<NotifTipo>()
  const estadoJson = a.col.estado as unknown as Prisma.InputJsonValue
  const dadosAusente = (ausente: boolean): NotifDados => (ausente ? { ausenteDesde: iso(a.prevAtividade) } : {})

  const unicos = a.col.unicos.slice(0, CAP_UNICOS)
  const grupos = agrupar(a.col.agg, ehAusente)
  const nada = unicos.length === 0 && grupos.length === 0

  const reivindicar = async (tx: Prisma.TransactionClient | typeof db): Promise<boolean> => {
    if (!a.cursor) {
      const c = await tx.notificationCursor.createMany({
        data: [{ userId, workspaceId, sincronizadoAte: a.upTo, ultimaAtividadeEm: a.presenca, estado: estadoJson }],
        skipDuplicates: true,
      })
      return c.count === 1
    }
    const c = await tx.notificationCursor.updateMany({
      where: { userId, workspaceId, sincronizadoAte: a.cursor.sincronizadoAte },
      data: { sincronizadoAte: a.upTo, ultimaAtividadeEm: a.presenca, estado: estadoJson },
    })
    return c.count === 1
  }

  if (nada) {
    await reivindicar(db) // só avança o cursor e a presença (uma gravação)
    return null
  }

  const contagens: Partial<Record<NotifTipo, number>> = {}
  let nivelCota: number | undefined
  const ganhou = await db.$transaction(
    async (tx) => {
      if (!(await reivindicar(tx))) return false // outra aba/chamada já tratou esta janela

      if (unicos.length > 0) {
        await tx.notification.createMany({
          data: unicos.map((u) => {
            const ausente = ehAusente(u.at)
            return {
              userId,
              workspaceId,
              tipo: u.tipo,
              titulo: u.titulo,
              corpo: u.corpo,
              contagem: 1,
              link: u.link,
              dados: { ...(u.dados ?? {}), ...dadosAusente(ausente) } as Prisma.InputJsonValue,
              ausente,
              dedupeKey: u.key,
              ocorridoEm: u.at,
              lidaEm: !ausente && lerAoVivo.has(u.tipo) ? a.now : null,
            }
          }),
          skipDuplicates: true,
        })
        for (const u of unicos) {
          if (ehAusente(u.at)) contagens[u.tipo] = (contagens[u.tipo] ?? 0) + 1
          if (u.tipo === 'cota_ia') nivelCota = u.dados?.nivel
        }
      }

      for (const g of grupos) {
        const lidaAgora = !g.ausente && lerAoVivo.has(g.tipo) ? a.now : null
        const maisRecente = g.fatos.reduce((m, f) => maxDate(m, f.at), g.fatos[0].at)
        const existente = await tx.notification.findFirst({
          where: {
            userId,
            workspaceId,
            tipo: g.tipo,
            ausente: g.ausente,
            lidaEm: null,
            apagadaEm: null,
            dedupeKey: { startsWith: 'agg:' },
            createdAt: { gt: new Date(a.now.getTime() - JANELA_SOMA_MS) },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, refIds: true, ocorridoEm: true, dados: true },
        })
        const est = existente ? lerEstado(existente.refIds) : estadoVazio()
        const novos = somar(est, g.fatos)
        if (novos === 0) continue
        if (g.ausente) contagens[g.tipo] = (contagens[g.tipo] ?? 0) + novos
        const { titulo, corpo } = textoAgregado(g.tipo, est)
        const link = linkAgregado(g.tipo, est)
        if (existente) {
          await tx.notification.update({
            where: { id: existente.id },
            data: {
              titulo,
              corpo,
              contagem: totalDe(est),
              link,
              refIds: est as unknown as Prisma.InputJsonValue,
              ocorridoEm: maxDate(existente.ocorridoEm, maisRecente),
              ...(lidaAgora ? { lidaEm: lidaAgora } : {}),
            },
          })
        } else {
          await tx.notification.create({
            data: {
              userId,
              workspaceId,
              tipo: g.tipo,
              titulo,
              corpo,
              contagem: totalDe(est),
              link,
              refIds: est as unknown as Prisma.InputJsonValue,
              dados: dadosAusente(g.ausente) as Prisma.InputJsonValue,
              ausente: g.ausente,
              dedupeKey: `agg:${g.tipo}:${g.ausente ? 'a' : 'p'}:${a.upTo.getTime()}`,
              ocorridoEm: maisRecente,
              lidaEm: lidaAgora,
            },
          })
        }
      }
      return true
    },
    { timeout: 10_000, maxWait: 5_000 },
  )
  if (!ganhou) return null
  return a.away ? resumoAusente(contagens, nivelCota) : null
}

// ---------------------------------------------------------------------------------------------------------------------
// Presença, leitura, histórico, apagar
// ---------------------------------------------------------------------------------------------------------------------

/** Batimento leve: só atualiza a presença (nunca cria o cursor: quem cria é a primeira sincronização). */
export async function heartbeat(ctx: Contexto, now: Date = new Date()): Promise<void> {
  await baterPresenca(ctx.userId, ctx.workspaceId, now)
}

async function lerLista(userId: string, workspaceId: string, now: Date, take: number): Promise<{ itens: NotificationDTO[]; naoLidas: number }> {
  const base: Prisma.NotificationWhereInput = { userId, workspaceId, apagadaEm: null, createdAt: { gte: corte(now) } }
  const [rows, naoLidas] = await Promise.all([
    db.notification.findMany({ where: base, orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }], take, select: SELECT_DTO }),
    db.notification.count({ where: { ...base, lidaEm: null } }),
  ])
  return { itens: rows.map(toDTO), naoLidas }
}

/** Histórico paginado (7 dias). `antes` é o `proximo` devolvido pela página anterior. */
export async function listNotifications(ctx: Contexto, opts: { antes?: string | null; limite?: number; now?: Date } = {}): Promise<ListResponse> {
  const now = opts.now ?? new Date()
  const take = Math.min(Math.max(opts.limite ?? ITENS_PAGINA, 1), 100)
  const base: Prisma.NotificationWhereInput = { userId: ctx.userId, workspaceId: ctx.workspaceId, apagadaEm: null, createdAt: { gte: corte(now) } }
  const where: Prisma.NotificationWhereInput = { ...base }
  const k = opts.antes ? parseCursor(opts.antes) : null
  if (k) where.OR = [{ ocorridoEm: { lt: k.t } }, { ocorridoEm: k.t, id: { lt: k.id } }]
  const [rows, naoLidas] = await Promise.all([
    db.notification.findMany({ where, orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }], take: take + 1, select: SELECT_DTO }),
    db.notification.count({ where: { ...base, lidaEm: null } }),
  ])
  const pagina = rows.slice(0, take)
  const ultimo = pagina[pagina.length - 1]
  return { itens: pagina.map(toDTO), proximo: rows.length > take && ultimo ? `${ultimo.ocorridoEm.getTime()}_${ultimo.id}` : null, naoLidas }
}

export function parseCursor(s: string): { t: Date; id: string } | null {
  const m = /^(\d{10,14})_([A-Za-z0-9_-]{1,64})$/.exec(s)
  if (!m) return null
  const t = new Date(Number(m[1]))
  return Number.isNaN(t.getTime()) ? null : { t, id: m[2] }
}

/** Quantas dessas ids são desta pessoa, neste espaço e ainda existem (para devolver 404 em ids alheias). */
async function contarProprias(ctx: Contexto, ids: string[]): Promise<number> {
  return db.notification.count({ where: { id: { in: ids }, userId: ctx.userId, workspaceId: ctx.workspaceId, apagadaEm: null } })
}

export type ResultadoLista = { ok: true; alterados: number } | { ok: false; motivo: 'nao_encontrada' }

/** Marca como lidas: as ids informadas (todas precisam ser suas) ou, sem ids, todas as não lidas do espaço. */
export async function markRead(ctx: Contexto, ids?: string[], now: Date = new Date()): Promise<ResultadoLista> {
  if (ids) {
    const unicas = Array.from(new Set(ids))
    if (unicas.length === 0) return { ok: true, alterados: 0 }
    if ((await contarProprias(ctx, unicas)) !== unicas.length) return { ok: false, motivo: 'nao_encontrada' }
    const r = await db.notification.updateMany({ where: { id: { in: unicas }, userId: ctx.userId, workspaceId: ctx.workspaceId, apagadaEm: null, lidaEm: null }, data: { lidaEm: now } })
    return { ok: true, alterados: r.count }
  }
  const r = await db.notification.updateMany({ where: { userId: ctx.userId, workspaceId: ctx.workspaceId, apagadaEm: null, lidaEm: null }, data: { lidaEm: now } })
  return { ok: true, alterados: r.count }
}

/** Zera o conteúdo e deixa só a marca (a chave única impede que o mesmo evento volte). */
const lapide = (now: Date): Prisma.NotificationUpdateManyMutationInput => ({
  apagadaEm: now,
  lidaEm: now,
  titulo: '',
  corpo: null,
  link: null,
  refIds: Prisma.DbNull,
  dados: Prisma.DbNull,
})

export async function deleteNotification(ctx: Contexto, id: string, now: Date = new Date()): Promise<ResultadoLista> {
  const r = await db.notification.updateMany({ where: { id, userId: ctx.userId, workspaceId: ctx.workspaceId, apagadaEm: null }, data: lapide(now) })
  return r.count === 1 ? { ok: true, alterados: 1 } : { ok: false, motivo: 'nao_encontrada' }
}

/** Limpa TODO o histórico da pessoa neste espaço. O cursor não volta atrás: o que foi apagado não reaparece. */
export async function clearNotifications(ctx: Contexto, now: Date = new Date()): Promise<number> {
  const r = await db.notification.updateMany({ where: { userId: ctx.userId, workspaceId: ctx.workspaceId, apagadaEm: null }, data: lapide(now) })
  return r.count
}

// ---------------------------------------------------------------------------------------------------------------------
// Retenção
// ---------------------------------------------------------------------------------------------------------------------

const holder = globalThis as unknown as { __pearchat_notif_purge?: number }
const PURGE_EVERY_MS = 10 * 60_000
/** Cursor sem uso há mais que isso é descartado (a pessoa volta como numa primeira sincronização). */
const CURSOR_MAX_IDLE_MS = 30 * 24 * 3_600_000

/**
 * Apaga de verdade o que passou de 7 dias (de todos os usuários: um comando só, pelo índice de createdAt).
 * No máximo uma vez a cada 10 min por processo; `force` ignora o intervalo (testes).
 */
export async function purgeExpired(now: Date = new Date(), force = false): Promise<number> {
  const last = holder.__pearchat_notif_purge ?? 0
  if (!force && now.getTime() - last < PURGE_EVERY_MS) return 0
  holder.__pearchat_notif_purge = now.getTime()
  try {
    const r = await db.notification.deleteMany({ where: { createdAt: { lt: corte(now) } } })
    await db.notificationCursor.deleteMany({ where: { ultimaAtividadeEm: { lt: new Date(now.getTime() - CURSOR_MAX_IDLE_MS) } } })
    return r.count
  } catch (e) {
    console.error('[notifications] limpeza falhou:', e instanceof Error ? e.message : 'erro')
    return 0
  }
}
