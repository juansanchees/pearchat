import { NextResponse } from 'next/server'
import type { CalendarConnection, Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { addMin, overlaps } from './time'
import { googleConfigured } from './google'
import {
  LEMBRETES,
  MSG_CONFLITO,
  type ApiErrorBody,
  type CalendarStateDto,
  type CalendarioDto,
  type EventDto,
  type Lembrete,
} from './types'

export const eventInclude = {
  contact: { select: { id: true, nome: true, telefone: true } },
  serviceType: { select: { cor: true } },
} satisfies Prisma.EventInclude
export type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>

// Duração máxima de um evento (12 h): permite pré-filtrar por `inicio` nas consultas de sobreposição.
export const MAX_DURACAO_MIN = 720
export const MAX_EVENT_MS = MAX_DURACAO_MIN * 60_000

export function apiError(error: string, message: string, status: number): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error, message }, { status })
}

export const conflictResponse = (conflito: EventDto) =>
  NextResponse.json({ error: 'CONFLITO', message: MSG_CONFLITO, conflito }, { status: 409 })

export function toEventDto(e: EventRow): EventDto {
  return {
    id: e.id,
    inicio: e.inicio.toISOString(),
    fim: addMin(e.inicio, e.duracaoMin).toISOString(),
    duracaoMin: e.duracaoMin,
    titulo: e.titulo,
    tipo: e.tipo,
    origem: e.origem,
    contactId: e.contactId,
    serviceTypeId: e.serviceTypeId,
    ...(e.canal === 'link' ? { canal: 'link' as const } : {}),
    ...(e.origem === 'MANUAL' && e.serviceType?.cor ?{ cor: e.serviceType.cor } : {}),
    cliente: e.contact?.nome ?? null,
    noGoogle: e.googleEventId !== null,
  }
}

/** Eventos do workspace que se sobrepõem a [inicio, fim), exceto `ignoreId`. */
export async function findOverlapping(
  workspaceId: string,
  inicio: Date,
  fim: Date,
  ignoreId?: string,
): Promise<EventRow[]> {
  const rows = await db.event.findMany({
    where: {
      workspaceId,
      inicio: { gte: new Date(inicio.getTime() - MAX_EVENT_MS), lt: fim },
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    include: eventInclude,
  })
  return rows.filter((r) => overlaps(inicio, fim, r.inicio, addMin(r.inicio, r.duracaoMin)))
}

// ---------- conexão ----------

const calendarioStored = z.array(
  z.object({
    id: z.string(),
    nome: z.string(),
    selecionado: z.boolean(),
    principal: z.boolean().optional(),
    papel: z.string().optional(),
    cor: z.string().nullish(),
  }),
)

export function parseCalendarios(json: Prisma.JsonValue | null): CalendarioDto[] {
  const p = calendarioStored.safeParse(json)
  return p.success ? p.data : []
}

const isLembrete = (s: string): s is Lembrete => (LEMBRETES as readonly string[]).includes(s)

export const DEFAULT_LEMBRETES: Lembrete[] = ['24h', '2h']

/** Conexão "de verdade": provider google com tokens gravados. */
export const isRealConnection = (c: CalendarConnection | null): c is CalendarConnection =>
  c !== null && c.provider === 'google' && c.tokens !== null

export function toCalendarState(c: CalendarConnection | null): CalendarStateDto {
  const googleConfigurado = googleConfigured()
  if (!c) {
    return {
      conectado: false,
      email: null,
      calendarios: [],
      destinoId: null,
      iaPodeAgendar: true,
      duracaoPadraoMin: 60,
      lembretes: [...DEFAULT_LEMBRETES],
      demo: false,
      googleConfigurado,
      precisaReconectar: false,
      sincronizadoEm: null,
    }
  }
  const dur = c.duracaoPadraoMin
  return {
    conectado: true,
    email: c.email,
    calendarios: parseCalendarios(c.calendarios),
    destinoId: c.destinoId,
    iaPodeAgendar: c.iaPodeAgendar,
    duracaoPadraoMin: dur === 30 || dur === 120 ? dur : 60,
    lembretes: c.lembretes.filter(isLembrete),
    demo: c.provider !== 'google',
    googleConfigurado,
    precisaReconectar: c.provider === 'google' && c.precisaReconectar,
    sincronizadoEm: c.ultimaSyncEm ? c.ultimaSyncEm.toISOString() : null,
  }
}

export const getConnection = (workspaceId: string) =>
  db.calendarConnection.findUnique({ where: { workspaceId } })

/** Agenda-destino usada para criar eventos no Google (destinoId, ou a 1ª selecionada). */
export function destinoOf(c: CalendarConnection): string | null {
  if (c.destinoId) return c.destinoId
  return parseCalendarios(c.calendarios).find((x) => x.selecionado)?.id ?? null
}

/** Ids das agendas selecionadas (usadas no free/busy). */
export const selectedIds = (c: CalendarConnection): string[] =>
  parseCalendarios(c.calendarios)
    .filter((x) => x.selecionado)
    .map((x) => x.id)

/** Descrição do evento no Google: nome e telefone do cliente, quando houver. */
export function eventDescription(contact: { nome: string; telefone: string | null } | null): string {
  if (!contact) return 'Criado pelo PearChat'
  return [`Cliente: ${contact.nome}`, contact.telefone ? `Telefone: ${contact.telefone}` : null, 'Criado pelo PearChat']
    .filter(Boolean)
    .join('\n')
}

/** Falha do Google nunca derruba a operação local: registra só a mensagem (sem tokens). */
export function logGoogleFailure(op: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : 'erro desconhecido'
  console.error(`[calendar] Google falhou em ${op}: ${msg}`)
}

/**
 * Resolve o contato de um evento. `contactId` tem prioridade (precisa ser do workspace);
 * senão `cliente` (nome): reutiliza contato do workspace com o mesmo nome (sem diferenciar
 * maiúsculas) ou cria um contato novo só com o nome. Vazio/null -> sem contato.
 */
export async function resolveContactId(
  workspaceId: string,
  input: { contactId?: string | null; cliente?: string | null },
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (input.contactId) {
    const c = await db.contact.findFirst({
      where: { id: input.contactId, workspaceId },
      select: { id: true },
    })
    return c ? { ok: true, id: c.id } : { ok: false }
  }
  const nome = input.cliente?.trim()
  if (!nome) return { ok: true, id: null }
  const existing = await db.contact.findFirst({
    where: { workspaceId, nome: { equals: nome, mode: 'insensitive' } },
    select: { id: true },
  })
  if (existing) return { ok: true, id: existing.id }
  const created = await db.contact.create({
    data: { workspaceId, nome, tags: [] },
    select: { id: true },
  })
  return { ok: true, id: created.id }
}
