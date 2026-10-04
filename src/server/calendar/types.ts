// DTOs de resposta das rotas /api/events e /api/calendar (consumidos pela UI da Agenda).

export type EventOrigem = 'IA' | 'GOOGLE' | 'MANUAL'

/** Valores de lembrete aceitos. '24h' = 24 h antes, '2h' = 2 h antes, '30min' = 30 min antes. */
export const LEMBRETES = ['24h', '2h', '30min'] as const
export type Lembrete = (typeof LEMBRETES)[number]

export const DURACOES_PADRAO = [30, 60, 120] as const

export interface EventDto {
  id: string
  /** Início em ISO 8601 UTC (ex.: "2026-10-02T12:30:00.000Z" = 09:30 em São Paulo). */
  inicio: string
  /** Fim em ISO 8601 UTC (inicio + duracaoMin). */
  fim: string
  duracaoMin: number
  titulo: string
  tipo: string
  origem: EventOrigem
  contactId: string | null
  /** Tipo de atendimento escolhido (o texto `tipo` guarda o nome na hora do agendamento). */
  serviceTypeId?: string | null
  /** 'link' = veio da página pública de agendamento. */
  canal?: 'link' | null
  /** Nome do contato; null = "Cliente sem nome". */
  cliente: string | null
  /** true se o evento existe no Google Agenda (googleEventId preenchido). */
  noGoogle: boolean
  /** true = evento lido ao vivo do Google (origem 'GOOGLE'): a tela não permite excluir. */
  somenteLeitura?: boolean
  /** true = evento de dia inteiro (inicio/fim à meia-noite de São Paulo; fim exclusivo). */
  diaInteiro?: boolean
  /** Cor da agenda do Google (backgroundColor) ou, em eventos manuais, a cor do tipo de atendimento. */
  cor?: string | null
  /** Nome da agenda do Google de onde o evento foi lido. */
  agenda?: string | null
}

/** Situação da leitura ao vivo do Google numa listagem. */
export type GoogleListStatus = 'ok' | 'falhou' | 'reconectar' | 'desconectado'

/** GET /api/events?from=&to= */
export interface EventListResponse {
  /** Eventos locais + eventos das agendas selecionadas do Google (sem duplicar os do PearChat). */
  eventos: EventDto[]
  google: {
    status: GoogleListStatus
    /** Última leitura bem-sucedida do Google (ISO), se houver. */
    sincronizadoEm: string | null
  }
}

/** Resultado da tentativa de sincronizar com o Google numa criação. */
export type GoogleSyncStatus = 'ok' | 'falhou' | 'desconectado'

/** POST /api/events (201) e PATCH /api/events/[id] (200). */
export interface EventWriteResponse {
  evento: EventDto
  googleSync: GoogleSyncStatus
}

/** DELETE /api/events/[id] */
export interface EventDeleteResponse {
  ok: true
  googleSync: GoogleSyncStatus
}

/** GET /api/events/free?date=YYYY-MM-DD&duracaoMin= */
export interface FreeSlotsResponse {
  date: string
  duracaoMin: number
  /** Inícios livres "HH:MM" (fuso America/Sao_Paulo), passo de 30 min, entre 08:00 e 18:00. */
  horarios: string[]
  /** true se o free/busy do Google foi considerado de fato. */
  googleConsultado: boolean
}

export interface CalendarioDto {
  id: string
  nome: string
  /** Selecionada: o PearChat usa para bloquear horários ocupados e mostrar na grade. */
  selecionado: boolean
  principal?: boolean
  /** accessRole do Google: owner | writer | reader | freeBusyReader. */
  papel?: string
  /** backgroundColor da agenda no Google. */
  cor?: string | null
}

/** GET /api/calendar */
export interface CalendarStateDto {
  conectado: boolean
  email: string | null
  calendarios: CalendarioDto[]
  /** Agenda onde novos agendamentos são criados. */
  destinoId: string | null
  iaPodeAgendar: boolean
  duracaoPadraoMin: 30 | 60 | 120
  lembretes: Lembrete[]
  /** true = conexão simulada (provider 'google-demo', sem tokens). */
  demo: boolean
  /** true = GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET configurados no servidor. */
  googleConfigurado: boolean
  /** true = o Google revogou/invalidou o acesso: é preciso reconectar. */
  precisaReconectar: boolean
  /** Última leitura/sincronização bem-sucedida com o Google (ISO), se houver. */
  sincronizadoEm: string | null
}

/** Corpo de erro padrão destas rotas: `error` é um código estável, `message` o texto pt-BR. */
export interface ApiErrorBody {
  error: string
  message: string
}

export const MSG_CONFLITO = 'Já existe um compromisso nesse horário.'

/** Tipo de atendimento do negócio (GET/POST/PATCH /api/service-types). */
export interface ServiceTypeDto {
  id: string
  nome: string
  duracaoMin: number
  /** Cor "#rrggbb" ou null. */
  cor: string | null
  ordem: number
}

/** GET /api/service-types */
export interface ServiceTypeListResponse {
  tipos: ServiceTypeDto[]
}

export const MSG_ULTIMO_TIPO = 'Mantenha ao menos um tipo de atendimento ativo.'
