// Constantes e valores padrão dos drawers (spec 05-dados-ficticios.md).
// Os dados exibidos vêm das APIs; aqui ficam só as opções fixas da interface e os valores iniciais
// usados enquanto o banco não tem nada (ou antes do carregamento).

export type Tom = 'Amigável' | 'Profissional' | 'Direto'
export type Horario = 'Sempre' | 'Fora do expediente' | 'Só fins de semana'
export type KbItem = { id: string; p: string; r: string }

export const AGENTE_INICIAL = {
  canSchedule: false,
  nome: 'Luna',
  tom: 'Amigável' as Tom,
  horario: 'Sempre' as Horario,
  prompt: '',
}

export const HANDOFF_OPCOES = ['Pedido de desconto', 'Reclamação', 'Cliente pede um atendente', 'Pedido acima de R$ 500']
export const HANDOFF_INICIAL = ['Pedido de desconto', 'Cliente pede um atendente']

export type ListaId = 'todos' | 'clientes' | 'aniv' | 'frios'

export type DispState = { lista: ListaId; msg: string; quando: 'Agora' | 'Agendar'; intervalo: string; data: string }
export const DISP_INICIAL: DispState = {
  lista: 'clientes',
  msg: 'Oi, {primeiro_nome}! Temos novidades esta semana. Quer saber mais?',
  quando: 'Agora',
  intervalo: '15–30 s',
  data: '',
}
export const INTERVALOS = ['5–10 s', '15–30 s', '30–60 s']
/** Rótulo da tela -> valor da API. */
export const INTERVALO_API: Record<string, '5-10' | '15-30' | '30-60'> = { '5–10 s': '5-10', '15–30 s': '15-30', '30–60 s': '30-60' }

export type CampanhaStatus = 'Concluída' | 'Enviando' | 'Agendada' | 'Na fila' | 'Pausada'
export type Campanha = {
  id: string
  lista: string
  total: number
  enviadas: number
  respostas: number
  status: CampanhaStatus
  data: string
  /** Retida pelo horário de silêncio dos disparos. */
  retida?: boolean
}

export type Template = {
  id: string
  nome: string
  cat: 'Marketing' | 'Utilidade'
  status: 'Aprovado' | 'Em análise' | 'Rejeitado' | 'Pausado' | 'Desativado'
  corpo: string
  /** Motivo informado pela Meta (rejeição, pausa...). */
  motivo?: string | null
  /** Só existe no PearChat: ainda não foi enviado para a Meta. */
  soLocal?: boolean
  vars?: number
  exemplos?: string[]
  /** O PearChat não consegue usar o modelo em disparos (motivo). */
  naoSuportado?: string | null
}
export const TPL_PADRAO = 'promo_fim_de_semana'

// Padrão do follow-up quando a regra ainda não tem textos (mesmos textos do servidor).
export const FU_INICIAL = {
  espera: '24 h',
  tentativas: '2',
  msgs: [
    'Oi, {primeiro_nome}! Conseguiu ver minha última mensagem? Fico à disposição para o que precisar.',
    'Oi, {primeiro_nome}! Ainda posso ajudar com o que você procurava? Se preferir, é só me chamar por aqui.',
    'Oi, {primeiro_nome}! Vou encerrar por aqui para não incomodar. Quando quiser retomar, é só mandar uma mensagem.',
  ],
}
export const FU_PARAR_OPCOES = ['Cliente respondeu', 'Pedido fechado', 'Cliente pediu para parar']
export const FU_PARAR_INICIAL = ['Cliente respondeu', 'Pedido fechado']

export const NOTIF_OPCOES = ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído', 'Novo agendamento']
export const NOTIF_INICIAL = ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído']

export type PlanoNome = 'Essencial' | 'Pro' | 'Negócios'
export const PLANOS: { nome: PlanoNome; preco: string; desc: string }[] = [
  { nome: 'Essencial', preco: 'R$ 79/mês', desc: '1 WhatsApp, 500 respostas de IA e 1.000 disparos por mês' },
  { nome: 'Pro', preco: 'R$ 149/mês', desc: '3 WhatsApps, 3.000 respostas de IA, 10.000 disparos, follow-up e agenda' },
  { nome: 'Negócios', preco: 'R$ 299/mês', desc: '5 WhatsApps, IA e disparos ilimitados, suporte prioritário' },
]
export const PLANO_RANK: Record<PlanoNome, number> = { Essencial: 0, Pro: 1, Negócios: 2 }
export const HORARIO_ATENDIMENTO_PADRAO = 'Seg a sáb, 8h às 18h'
