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
  /** Foto do WhatsApp copiada pelo servidor (/api/contact-photo/<id>); null/ausente = só iniciais. */
  photoUrl?: string | null
  /** null = ninguém atendeu ainda */
  mode: ConversationModeKind | null
  unread: number
  typing: boolean
  lastMessagePreview: string | null
  /** ISO 8601 */
  lastMessageAt: string | null
  /** Equipe: responsável pela conversa; null/ausente = sem responsável. */
  assignee?: { id: string; nome: string; fotoUrl: string | null } | null
}

export type MediaTypeKind = 'image' | 'audio' | 'video' | 'document' | 'sticker'
export type MediaStatusKind = 'pendente' | 'ok' | 'erro' | 'expirada'
export type TranscriptStatusKind = 'pendente' | 'feito' | 'erro' | 'indisponivel'

export interface MessageDTO {
  id: string
  conversationId: string
  direction: MessageDirectionKind
  author: MessageAuthorKind
  body: string
  /** Derivado: `/api/media/<id>` quando o arquivo está guardado (nunca uma URL pública). */
  mediaUrl: string | null
  status: MessageStatusKind
  /** ISO 8601 */
  createdAt: string
  /** Equipe: quem enviou pelo app (primeiro nome em senderNome). */
  senderUserId?: string | null
  senderNome?: string | null
  /** Motivo curto da falha de envio (status 'falhou'); mostrado ao passar o mouse em "Falha no envio". */
  failReason?: string | null
  mediaType?: MediaTypeKind | null
  mediaMime?: string | null
  mediaSize?: number | null
  mediaName?: string | null
  mediaDurationSec?: number | null
  mediaStatus?: MediaStatusKind | null
  transcript?: string | null
  transcriptStatus?: TranscriptStatusKind | null
}

export interface WhatsAppStatusDTO {
  provider: ProviderKind | null
  status: ConnectionStatusKind
  numero: string | null
  /** QR (data URL ou string do código) quando status = aguardando_qr */
  qr?: string
  /** API oficial: número que continua no app WhatsApp Business (Coexistence). */
  coexistence?: boolean
}

// ---- Drawers (agente de IA, follow-up, disparos, configurações, plano) ----

export type AgentTom = 'Amigável' | 'Profissional' | 'Direto'
export type AgentHorario = 'Sempre' | 'Fora do expediente' | 'Só fins de semana'
/** Idioma das respostas da IA: auto = o idioma do cliente. */
export type AgentIdioma = 'auto' | 'pt' | 'en' | 'es'

export interface AgentDTO {
  nome: string
  tom: AgentTom
  prompt: string
  horario: AgentHorario
  handoffRules: string[]
  canSchedule: boolean
  idioma: AgentIdioma
  /** Ritmo natural: "digitando…" e pausa proporcional antes de a IA responder. */
  ritmoNatural: boolean
  /** Agenda: perguntar "posso confirmar?" antes de criar (remarcar/cancelar confirmam sempre). */
  confirmarAgendamento: boolean
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
  status: 'APROVADO' | 'EM_ANALISE' | 'REJEITADO' | 'PAUSADO' | 'DESATIVADO'
  body: string
  /** Idioma na Meta (padrão pt_BR). */
  language?: string
  /** Motivo informado pela Meta quando o modelo não foi aprovado. */
  rejectionReason?: string | null
  /** true = só existe no PearChat (ainda não foi enviado para a Meta). */
  onlyLocal?: boolean
  /** Quantidade de variáveis {{n}} do corpo. */
  vars?: number
  /** Exemplos enviados à Meta, um por variável. */
  examples?: string[]
  /** Motivo pelo qual o PearChat não consegue usar este modelo em disparos (cabeçalho com mídia, botão com variável...). */
  unsupported?: string | null
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
  /** Hora cheia (0-23, fuso do espaço). A janela pode cruzar a meia-noite. */
  silencioInicio: number
  silencioFim: number
}

export interface SettingsDTO {
  nome: string
  email: string
  empresa: string
  horarioAtendimento: string
  notifs: string[]
  /** DDI acrescentado a número digitado SEM DDI neste WhatsApp (só dígitos, ex.: "55", "52"). */
  ddiPadrao: string
  /** Fuso horário IANA do negócio (agenda, lembretes, silêncio dos disparos, horário da IA, link público). */
  timezone: string
}

export interface BillingDTO {
  plano: 'Essencial' | 'Pro' | 'Negócios'
  uso: {
    mensagensAtendimento: number
    respostasIa: number
    /** Segundos de áudio transcritos no mês (soma da organização). */
    transcricoesSeg: number
    disparos: number
    contatos: number
  }
  limites: { respostasIa: number | null; disparos: number | null; contatos: number | null }
  /** WhatsApps (espaços) em uso e o máximo do plano. */
  espacos: { usados: number; limite: number }
  /** Equipe: pessoas ativas + convites pendentes e o máximo do plano. */
  pessoas?: { usados: number; limite: number }
  faturas: { id: string; mes: string; valor: number; status: string; pdfUrl: string | null }[]
  /** Só existe com BILLING_ENABLED=true (rota /api/billing, dono). */
  cobranca?: CobrancaInfo
}

export interface CobrancaInfo {
  ativo: true
  status: 'trial' | 'ativa' | 'pendente' | 'atrasada' | 'cancelada' | 'isenta'
  restrito: boolean
  motivo: string | null
  trialDias: number | null
  trialAte: string | null
  proximaCobranca: string | null
  canceladaEm: string | null
  planoPendente: string | null
  planoAgendado: string | null
  temAssinatura: boolean
  documento: string | null
  precos: Record<string, number>
  faturas: { id: string; valor: number; status: string; vencimento: string | null; pagoEm: string | null; invoiceUrl: string | null }[]
}
