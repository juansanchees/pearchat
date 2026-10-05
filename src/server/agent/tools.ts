import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  cancelIaBooking,
  createIaBooking,
  diaSemanaOf,
  futureEventsOf,
  listServices,
  localIso,
  nextDaysWithSlots,
  parseLocalInstant,
  quandoExtenso,
  rescheduleIaBooking,
  resolveService,
  slotsOfDay,
} from '@/server/calendar/scheduling'
import { spToDate } from '@/server/calendar/time'
import { spParts } from '@/server/engine/util'

// Ferramentas de agenda que o modelo pode chamar (function calling). REGRAS DE SEGURANÇA:
// - todas rodam no workspace e no contato da CONVERSA (vêm do servidor, nunca do modelo);
// - remarcar/cancelar só mexem em agendamentos do próprio contato;
// - criar/remarcar só aceitam um horário que listar_horarios_livres devolveu nesta conversa nos últimos 30 min;
// - no máximo 2 agendamentos criados pela IA por contato por dia (scheduling.ts);
// - no "Testar o agente" (dryRun) as de escrita só simulam.

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> }

export type ToolLogEntry = { nome: string; ok: boolean; erro?: string }

/** Horário oferecido ao cliente: serviço + início (ISO UTC) + quando foi mostrado (ms). */
export type Offer = { s: string; i: string; t: number }

export const OFFER_TTL_MS = 30 * 60_000
const OFFERS_MAX = 120

export type ToolContext = {
  workspaceId: string
  /** null = "Testar o agente" (sem conversa): leitura vale, escrita só simula. */
  conversationId: string | null
  contactId: string | null
  now?: () => Date
  dryRun?: boolean
}

const str = (max: number) => z.string().trim().min(1).max(max)

export type Periodo = 'manha' | 'tarde' | 'noite'
/** Aceita "manhã", "Tarde"... (o modelo às vezes manda com acento); valor desconhecido continua sendo recusado pela validação. */
const periodoSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : v === null ? undefined : v),
  z.enum(['manha', 'tarde', 'noite']).optional(),
)
/** manhã < 12:00; tarde 12:00 a 17:59; noite a partir das 18:00. `hm` = "HH:MM". */
export function noPeriodo(hm: string, p: Periodo): boolean {
  const h = Number(hm.slice(0, 2))
  return p === 'manha' ? h < 12 : p === 'tarde' ? h >= 12 && h < 18 : h >= 18
}

const schemas = {
  listar_servicos: z.object({}).passthrough(),
  listar_horarios_livres: z.object({ data: str(10), servico: str(80), periodo: periodoSchema }),
  criar_agendamento: z.object({ servico: str(80), inicio: str(30), nome: z.string().trim().max(80).optional() }),
  consultar_agendamentos: z.object({}).passthrough(),
  remarcar_agendamento: z.object({ agendamentoId: str(60), novoInicio: str(30) }),
  cancelar_agendamento: z.object({ agendamentoId: str(60) }),
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'listar_servicos',
    description: 'Lista os serviços (tipos de atendimento) que podem ser agendados, com a duração de cada um.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'listar_horarios_livres',
    description:
      'Consulta os horários livres de UM dia para um serviço. Use SEMPRE antes de oferecer ou criar qualquer horário. Se o dia estiver cheio, devolve também os próximos dias com vaga.',
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Dia no formato AAAA-MM-DD (fuso de São Paulo).' },
        servico: { type: 'string', description: 'Nome do serviço, como na lista de serviços.' },
        periodo: {
          type: 'string',
          enum: ['manha', 'tarde', 'noite'],
          description: 'Opcional. Passe quando o cliente pediu um período: manha (antes das 12:00), tarde (12:00 a 17:59) ou noite (a partir das 18:00). Só horários desse período são devolvidos e liberados para agendar.',
        },
      },
      required: ['data', 'servico'],
      additionalProperties: false,
    },
  },
  {
    name: 'criar_agendamento',
    description:
      'Cria o agendamento do cliente desta conversa. Só chame quando o cliente tiver escolhido serviço, dia e hora (e confirmado, se as regras de AGENDAMENTO pedirem confirmação), e só com um horário devolvido por listar_horarios_livres.',
    parameters: {
      type: 'object',
      properties: {
        servico: { type: 'string', description: 'Nome do serviço.' },
        inicio: { type: 'string', description: 'Início no horário de São Paulo, formato AAAA-MM-DDTHH:MM (ex.: 2026-10-05T15:00).' },
        nome: { type: 'string', description: 'Nome do cliente, se ele disse.' },
      },
      required: ['servico', 'inicio'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_agendamentos',
    description: 'Lista os agendamentos FUTUROS do cliente desta conversa (só dele). Use antes de remarcar ou cancelar.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'remarcar_agendamento',
    description:
      'Muda o horário de um agendamento do cliente desta conversa. Só chame depois de o cliente confirmar o novo dia e hora, e com um horário devolvido por listar_horarios_livres para o mesmo serviço.',
    parameters: {
      type: 'object',
      properties: {
        agendamentoId: { type: 'string', description: 'Id devolvido por consultar_agendamentos.' },
        novoInicio: { type: 'string', description: 'Novo início, formato AAAA-MM-DDTHH:MM (São Paulo).' },
      },
      required: ['agendamentoId', 'novoInicio'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancelar_agendamento',
    description: 'Cancela um agendamento do cliente desta conversa. Só chame depois de o cliente confirmar que quer cancelar aquele horário.',
    parameters: {
      type: 'object',
      properties: { agendamentoId: { type: 'string', description: 'Id devolvido por consultar_agendamentos.' } },
      required: ['agendamentoId'],
      additionalProperties: false,
    },
  },
]

type Result = Record<string, unknown>

const failRes = (codigo: string, erro: string, extra: Result = {}): Result => ({ ok: false, codigo, erro, ...extra })

function parseOffers(json: Prisma.JsonValue | null | undefined, now: number): Offer[] {
  if (!Array.isArray(json)) return []
  const out: Offer[] = []
  for (const o of json) {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const { s, i, t } = o as Record<string, unknown>
      if (typeof s === 'string' && typeof i === 'string' && typeof t === 'number' && now - t < OFFER_TTL_MS) out.push({ s, i, t })
    }
  }
  return out
}

/**
 * Cria o executor de ferramentas de UMA execução do agente. `log` acumula as chamadas (nome, ok, código do erro: nunca dados
 * pessoais) para gravar no AiJob.
 */
export function createToolRunner(ctx: ToolContext) {
  const nowFn = ctx.now ?? (() => new Date())
  const log: ToolLogEntry[] = []
  const simulated: string[] = []
  let offers: Offer[] | null = null

  async function loadOffers(): Promise<Offer[]> {
    if (offers) return offers
    if (!ctx.conversationId) return (offers = [])
    const c = await db.conversation.findFirst({ where: { id: ctx.conversationId, workspaceId: ctx.workspaceId }, select: { ofertasIa: true } })
    return (offers = parseOffers(c?.ofertasIa, nowFn().getTime()))
  }

  async function addOffers(list: Offer[], manter?: (o: Offer) => boolean): Promise<void> {
    const cur = (await loadOffers()).filter((o) => nowFn().getTime() - o.t < OFFER_TTL_MS && (!manter || manter(o)))
    const keys = new Set(list.map((o) => `${o.s}|${o.i}`))
    offers = [...cur.filter((o) => !keys.has(`${o.s}|${o.i}`)), ...list].slice(-OFFERS_MAX)
    if (ctx.conversationId) {
      await db.conversation.updateMany({
        where: { id: ctx.conversationId, workspaceId: ctx.workspaceId },
        data: { ofertasIa: offers as unknown as Prisma.InputJsonValue },
      })
    }
  }

  async function wasOffered(serviceId: string, inicio: Date): Promise<boolean> {
    const t = nowFn().getTime()
    return (await loadOffers()).some((o) => o.s === serviceId && o.i === inicio.toISOString() && t - o.t < OFFER_TTL_MS)
  }

  const naoOferecido = (): Result =>
    failRes('HORARIO_NAO_CONSULTADO', 'Esse horário não foi consultado com listar_horarios_livres para esse serviço (ou a consulta tem mais de 30 minutos). Consulte o dia de novo e use um horário devolvido.')

  async function listarServicos(): Promise<Result> {
    const all = await listServices(ctx.workspaceId)
    return { ok: true, servicos: all.map((s) => ({ nome: s.nome, duracaoMin: s.duracaoMin })) }
  }

  async function listarHorarios(a: z.infer<typeof schemas.listar_horarios_livres>): Promise<Result> {
    const rs = await resolveService(ctx.workspaceId, a.servico)
    if (!rs.ok) return failRes(rs.codigo, rs.erro, { servicos: rs.servicos })
    const now = nowFn()
    const day = await slotsOfDay(ctx.workspaceId, rs.st, a.data, now)
    if (!day.ok) return failRes(day.codigo, day.erro)
    const t = now.getTime()
    const novos: Offer[] = []
    const reg = (date: string, hs: string[]) => {
      for (const h of hs) novos.push({ s: rs.st.id, i: spToDate(date, h).toISOString(), t })
    }
    const per = a.periodo
    const filtra = (hs: string[]) => (per ? hs.filter((h) => noPeriodo(h, per)) : hs)
    const horarios = filtra(day.horarios)
    reg(a.data, horarios)
    const res: Result = {
      ok: true,
      data: a.data,
      diaSemana: diaSemanaOf(a.data),
      servico: rs.st.nome,
      duracaoMin: rs.st.duracaoMin,
      horarios,
      ...(per ? { periodo: per } : {}),
    }
    if (horarios.length === 0) {
      if (per && day.horarios.length > 0) {
        res.semVagaNoPeriodo = true
        res.observacao = `Não há horário livre nesse dia no período pedido (${per}). Diga isso ao cliente e pergunte se aceita outro período ou outro dia; só então consulte de novo.`
      } else {
        res.diaCheio = true
      }
      const prox = await nextDaysWithSlots(ctx.workspaceId, rs.st, a.data, now, 2, per ? { filtro: (h) => noPeriodo(h, per) } : {})
      res.proximosDiasComVaga = prox
      for (const p of prox) reg(p.data, p.horarios)
    }
    // Com período pedido, ofertas antigas desse serviço e dia fora do período deixam de valer: o servidor só aceita criar/remarcar dentro dele.
    await addOffers(
      novos,
      per ? (o) => !(o.s === rs.st.id && localIso(new Date(o.i)).slice(0, 10) === a.data && !noPeriodo(localIso(new Date(o.i)).slice(11, 16), per)) : undefined,
    )
    return res
  }

  async function criar(a: z.infer<typeof schemas.criar_agendamento>): Promise<Result> {
    const rs = await resolveService(ctx.workspaceId, a.servico)
    if (!rs.ok) return failRes(rs.codigo, rs.erro, { servicos: rs.servicos })
    const inicio = parseLocalInstant(a.inicio)
    if (!inicio) return failRes('DATA_INVALIDA', 'Início inválido. Use AAAA-MM-DDTHH:MM (horário de São Paulo).')
    if (!(await wasOffered(rs.st.id, inicio))) return naoOferecido()
    const dry = ctx.dryRun || !ctx.contactId
    const r = await createIaBooking({ workspaceId: ctx.workspaceId, contactId: ctx.contactId, st: rs.st, inicio, nome: a.nome, now: nowFn(), dryRun: dry })
    if (!r.ok) return failRes(r.codigo, r.erro, r.alternativas ? { alternativas: r.alternativas } : {})
    const quando = quandoExtenso(inicio)
    if (r.simulado) {
      simulated.push(`agendaria ${rs.st.nome} para ${quando}`)
      return { ok: true, simulacao: true, mensagem: `[simulação] agendaria ${rs.st.nome} para ${quando}. Nada foi gravado; responda ao cliente como se tivesse agendado.` }
    }
    return {
      ok: true,
      agendamentoId: r.event.id,
      servico: rs.st.nome,
      inicio: localIso(inicio),
      quando,
      duracaoMin: rs.st.duracaoMin,
      ...(r.jaExistia ? { observacao: 'Esse agendamento já existia; nada foi duplicado.' } : {}),
    }
  }

  async function consultar(): Promise<Result> {
    if (!ctx.contactId) return { ok: true, agendamentos: [], observacao: 'Modo de teste: não há cliente real nesta conversa.' }
    const list = await futureEventsOf(ctx.workspaceId, ctx.contactId, nowFn())
    if (list.length === 0) return { ok: true, agendamentos: [], observacao: 'O cliente não tem agendamentos futuros.' }
    return {
      ok: true,
      agendamentos: list.map((e) => ({ id: e.id, servico: e.servico, inicio: localIso(e.inicio), quando: quandoExtenso(e.inicio), confirmacao: e.confirmacao })),
    }
  }

  async function remarcar(a: z.infer<typeof schemas.remarcar_agendamento>): Promise<Result> {
    const novoInicio = parseLocalInstant(a.novoInicio)
    if (!novoInicio) return failRes('DATA_INVALIDA', 'Início inválido. Use AAAA-MM-DDTHH:MM (horário de São Paulo).')
    if (!ctx.contactId) return failRes('NAO_ENCONTRADO', 'Modo de teste: não há agendamentos reais para remarcar.')
    const cur = await db.event.findFirst({
      where: { id: a.agendamentoId, workspaceId: ctx.workspaceId, contactId: ctx.contactId, status: 'ativo' },
      select: { serviceTypeId: true, tipo: true },
    })
    if (!cur) return failRes('NAO_ENCONTRADO', 'Agendamento não encontrado para este cliente. Consulte os agendamentos antes.')
    // Serviço apagado depois do agendamento: a oferta vale pelo nome (o modelo listou com o nome do tipo).
    const rs = cur.serviceTypeId ? { ok: true as const, id: cur.serviceTypeId } : null
    const serviceId = rs?.id ?? (await resolveService(ctx.workspaceId, cur.tipo).then((x) => (x.ok ? x.st.id : '')))
    if (!serviceId || !(await wasOffered(serviceId, novoInicio))) return naoOferecido()
    const r = await rescheduleIaBooking({ workspaceId: ctx.workspaceId, contactId: ctx.contactId, eventId: a.agendamentoId, novoInicio, now: nowFn(), dryRun: ctx.dryRun })
    if (!r.ok) return failRes(r.codigo, r.erro, r.alternativas ? { alternativas: r.alternativas } : {})
    const quando = quandoExtenso(novoInicio)
    if (r.simulado) {
      simulated.push(`remarcaria para ${quando}`)
      return { ok: true, simulacao: true, mensagem: `[simulação] remarcaria para ${quando}. Nada foi gravado; responda ao cliente como se tivesse remarcado.` }
    }
    return { ok: true, agendamentoId: r.event.id, inicio: localIso(novoInicio), quando }
  }

  async function cancelar(a: z.infer<typeof schemas.cancelar_agendamento>): Promise<Result> {
    if (!ctx.contactId) return failRes('NAO_ENCONTRADO', 'Modo de teste: não há agendamentos reais para cancelar.')
    const r = await cancelIaBooking({ workspaceId: ctx.workspaceId, contactId: ctx.contactId, eventId: a.agendamentoId, now: nowFn(), dryRun: ctx.dryRun })
    if (!r.ok) return failRes(r.codigo, r.erro)
    const quando = quandoExtenso(r.event.inicio)
    if (r.simulado) {
      simulated.push(`cancelaria o horário de ${quando}`)
      return { ok: true, simulacao: true, mensagem: `[simulação] cancelaria o agendamento de ${quando}. Nada foi gravado; responda como se tivesse cancelado.` }
    }
    return { ok: true, cancelado: quando, ...(r.jaCancelado ? { observacao: 'Já estava cancelado.' } : {}) }
  }

  /** Executa uma ferramenta pelo nome. Nunca lança: erro vira { ok:false, erro } para o modelo corrigir. */
  async function run(name: string, args: unknown): Promise<Result> {
    const finish = (res: Result): Result => {
      log.push({ nome: name, ok: res.ok === true, ...(res.ok === true ? {} : { erro: String(res.codigo ?? 'ERRO') }) })
      return res
    }
    const schema = (schemas as Record<string, z.ZodTypeAny>)[name]
    if (!schema) return finish(failRes('FERRAMENTA_DESCONHECIDA', `A ferramenta "${name}" não existe. Use só: ${TOOL_DEFS.map((d) => d.name).join(', ')}.`))
    const parsed = schema.safeParse(args ?? {})
    if (!parsed.success) {
      const campos = parsed.error.issues.map((i) => i.path.join('.') || 'argumentos').join(', ')
      return finish(failRes('ARGUMENTOS_INVALIDOS', `Argumentos inválidos (${campos}). Corrija e chame de novo.`))
    }
    try {
      const a = parsed.data as never
      switch (name) {
        case 'listar_servicos':
          return finish(await listarServicos())
        case 'listar_horarios_livres':
          return finish(await listarHorarios(a))
        case 'criar_agendamento':
          return finish(await criar(a))
        case 'consultar_agendamentos':
          return finish(await consultar())
        case 'remarcar_agendamento':
          return finish(await remarcar(a))
        default:
          return finish(await cancelar(a))
      }
    } catch (e) {
      console.error(`[agent:tools] ${name} falhou (${e instanceof Error ? e.name : 'erro'})`)
      return finish(failRes('ERRO_INTERNO', 'Não foi possível concluir agora. Passe a conversa para a equipe confirmar o horário (uma frase curta e o marcador de passagem).'))
    }
  }

  return { defs: TOOL_DEFS, run, log, simulated }
}

export type ToolRunner = ReturnType<typeof createToolRunner>

/** Data de hoje e dias da semana dos próximos 14 dias, para o prompt (o modelo erra a conta de calendário sozinho). */
export function miniCalendar(now: Date, dias = 14): string {
  const out: string[] = []
  const base = spParts(now).ymd
  for (let i = 0; i < dias; i++) {
    const d = new Date(`${base}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    const ymd = d.toISOString().slice(0, 10)
    const rot = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : null
    out.push(`${ymd} = ${diaSemanaOf(ymd)}${rot ? ` (${rot})` : ''}`)
  }
  return out.join('; ')
}
