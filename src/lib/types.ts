// Contratos compartilhados entre front, API e servidor realtime.
// DTOs usam valores em minúsculas; os enums do Prisma ficam em MAIÚSCULAS (veja src/lib/mappers.ts).

export type ProviderKind = 'oficial' | 'rapida'

export type ConnectionStatusKind = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado' | 'erro'

export type AutomationKey = 'ia' | 'disparos' | 'followup'

export type DrawerKey = AutomationKey | 'config' | 'plano' | 'resultados'

export type ConversationModeKind = 'ia' | 'humano'
export type MessageAuthorKind = 'cliente' | 'user' | 'ia'
export type MessageDirectionKind = 'in' | 'out'
export type MessageStatusKind = 'pendente' | 'enviada' | 'entregue' | 'lida' | 'falhou'

export interface ConversationListItem {
  id: string
  contactId: string
  nome: string
  telefone: string | null
  /** null = ninguém atendeu ainda */
  mode: ConversationModeKind | null
  unread: number
  typing: boolean
  lastMessagePreview: string | null
  /** ISO 8601 */
  lastMessageAt: string | null
}

export interface MessageDTO {
  id: string
  conversationId: string
  direction: MessageDirectionKind
  author: MessageAuthorKind
  body: string
  mediaUrl: string | null
  status: MessageStatusKind
  /** ISO 8601 */
  createdAt: string
}

export interface WhatsAppStatusDTO {
  provider: ProviderKind | null
  status: ConnectionStatusKind
  numero: string | null
  /** QR (data URL ou string do código) quando status = aguardando_qr */
  qr?: string
}

// ---- Drawers (agente de IA, follow-up, disparos, configurações, plano) ----

export type AgentTom = 'Amigável' | 'Profissional' | 'Direto'
export type AgentHorario = 'Sempre' | 'Fora do expediente' | 'Só fins de semana'

export interface AgentDTO {
  nome: string
  tom: AgentTom
  prompt: string
  horario: AgentHorario
  handoffRules: string[]
  canSchedule: boolean
}

export interface KnowledgeItemDTO {
  id: string
  pergunta: string
  resposta: string
}

export interface AgentTestResultDTO {
  resposta: string
  /** true quando a regra de passagem para o usuário foi acionada */
  handoff: boolean
  /** true quando não há chave de IA configurada e a resposta veio do simulador do protótipo */
  simulado: boolean
}

export interface FollowUpDTO {
  esperaHoras: 2 | 6 | 24
  tentativas: 1 | 2 | 3
  mensagens: string[]
  stopConditions: string[]
}

export interface FollowUpQueueItemDTO {
  id: string
  nome: string
  sigla: string
  tentativa: number
  /** ISO 8601 */
  runAt: string
}

export type CampaignListId = 'todos' | 'clientes' | 'aniv' | 'frios'
export type CampaignInterval = '5-10' | '15-30' | '30-60'
/** Valor do status no banco (Campaign.status). "enviando" e "concluida" são escritos pelo worker de envio. */
export type CampaignStatusKind = 'agendada' | 'na_fila' | 'enviando' | 'pausada' | 'concluida'

export interface CampaignListDTO {
  id: CampaignListId
  nome: string
  desc: string
  qtd: number
}

export interface TemplateDTO {
  id: string
  name: string
  category: 'MARKETING' | 'UTILIDADE'
  status: 'APROVADO' | 'EM_ANALISE' | 'REJEITADO'
  body: string
}

export interface CampaignDTO {
  id: string
  lista: CampaignListId | string
  listaNome: string
  mensagem: string
  templateId: string | null
  status: CampaignStatusKind
  total: number
  enviadas: number
  respostas: number
  intervalo: CampaignInterval | null
  /** ISO 8601 */
  scheduledAt: string | null
  /** ISO 8601 */
  createdAt: string
  /** Em andamento, mas retida pelo horário de silêncio. */
  aguardandoHorario?: boolean
}

export interface DisparosSettingsDTO {
  silencioAtivo: boolean
  /** Hora cheia (0-23, São Paulo). A janela pode cruzar a meia-noite. */
  silencioInicio: number
  silencioFim: number
}

export interface SettingsDTO {
  nome: string
  email: string
  empresa: string
  horarioAtendimento: string
  notifs: string[]
}

export interface BillingDTO {
  plano: 'Essencial' | 'Pro' | 'Negócios'
  uso: {
    mensagensAtendimento: number
    respostasIa: number
    disparos: number
    contatos: number
  }
  limites: { respostasIa: number | null; disparos: number | null; contatos: number | null }
  /** WhatsApps (espaços) em uso e o máximo do plano. */
  espacos: { usados: number; limite: number }
  faturas: { id: string; mes: string; valor: number; status: string; pdfUrl: string | null }[]
}
