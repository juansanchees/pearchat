// Tipos e constantes do sininho. Sem imports de servidor: o cliente (src/components/notifications) usa este arquivo também.

/** Quanto tempo o histórico fica guardado. */
export const RETENCAO_DIAS = 7
export const RETENCAO_MS = RETENCAO_DIAS * 24 * 3_600_000
/** Primeira sincronização de um usuário num espaço: olha no máximo as últimas 24 h (não inunda). */
export const PRIMEIRA_JANELA_MS = 24 * 3_600_000
/** Sem batimento há mais que isso = a pessoa estava fora. */
export const AUSENTE_MS = 3 * 60_000
/** Margem para o que ainda está sendo gravado (commit, envio em andamento): a janela termina um pouco antes de "agora". */
export const SETTLE_MS = 8_000
/** Janelas menores que isso não valem uma varredura (ex.: duas abas sincronizando juntas). */
export const MIN_VARREDURA_MS = 10_000
/** Notificação agregada NÃO LIDA do mesmo tipo criada há menos que isso recebe a contagem nova em vez de criar outra. */
export const JANELA_SOMA_MS = 15 * 60_000
/** Itens individuais de agenda por tipo e sincronização; o excedente vira uma linha "N agendamentos ...". */
export const AGENDA_MAX_INDIVIDUAIS = 5
/** Quantos itens a sincronização devolve. */
export const ITENS_SYNC = 40
export const ITENS_PAGINA = 30

export const TIPOS = [
  'ia_respondeu',
  'passou_para_voce',
  'esperando_resposta',
  'nova_conversa',
  'agenda_novo',
  'agenda_remarcado',
  'agenda_cancelado',
  'agenda_confirmado',
  'agenda_remarcar',
  'followup',
  'campanha',
  'falha_envio',
  'whatsapp_desconectou',
  'whatsapp_reconectou',
  'equipe_convite',
  'cota_ia',
] as const
export type NotifTipo = (typeof TIPOS)[number]

export const isAgendaTipo = (t: string): t is Extract<NotifTipo, `agenda_${string}`> => t.startsWith('agenda_')

/** Tela em que a pessoa está (dica enviada pelo cliente; só serve para marcar como lido o que ela está vendo ao vivo). */
export const TELAS = ['conversas', 'agenda', 'contatos', 'outra'] as const
export type Tela = (typeof TELAS)[number]

/** Dados de apresentação guardados em Notification.dados (sem texto de mensagens). */
export type NotifDados = {
  /** Agenda: nome do cliente, instante do agendamento (ISO) e origem. */
  cliente?: string
  inicio?: string
  origem?: 'ia' | 'link'
  /** Linha que reúne vários agendamentos além do limite individual. */
  agregado?: boolean
  /** "Enquanto você esteve fora": desde quando (ISO). */
  ausenteDesde?: string
  /** Cota de IA: 80 = perto do limite, 100 = esgotada. */
  nivel?: number
  /** Campanha: números finais. */
  enviadas?: number
  falhas?: number
}

export type NotificationDTO = {
  id: string
  tipo: string
  titulo: string
  corpo: string | null
  contagem: number
  link: string | null
  ausente: boolean
  /** alta = passagem para a equipe, WhatsApp fora do ar, cota esgotada. */
  prioridade: 'alta' | 'normal'
  ocorridoEm: string
  lida: boolean
  dados: NotifDados | null
}

export type SyncResponse = {
  naoLidas: number
  itens: NotificationDTO[]
  /** Desde quando a pessoa esteve fora (só quando esta sincronização detectou a volta). */
  ausenteDesde: string | null
  /** Texto curto do que aconteceu enquanto esteve fora (para o aviso ao voltar). */
  resumoAusente: string | null
}

export type ListResponse = { itens: NotificationDTO[]; proximo: string | null; naoLidas: number }
