// Valores aceitos pelo onboarding (compartilhados entre a tela e a rota).
export const SEGMENTOS = {
  confeitaria: 'confeitaria e doces',
  restaurante: 'restaurante e delivery',
  beleza: 'beleza e estética',
  saude: 'saúde e clínicas',
  loja: 'loja e varejo',
  servicos: 'serviços',
  outro: 'outro',
} as const

export const OBJETIVOS = {
  ia: 'responder clientes com IA',
  disparos: 'enviar promoções e avisos',
  followup: 'recuperar quem parou de responder',
  agenda: 'organizar agendamentos',
} as const

export type SegmentoId = keyof typeof SEGMENTOS
export type ObjetivoId = keyof typeof OBJETIVOS
