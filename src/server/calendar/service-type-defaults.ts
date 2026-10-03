// Tipos de atendimento iniciais por segmento (ids do onboarding em src/app/api/onboarding/constants.ts).
// O dono edita tudo depois em Agenda > Editar tipos.

export interface ServiceTypeSeed {
  nome: string
  duracaoMin: number
}

const t = (nome: string, duracaoMin: number): ServiceTypeSeed => ({ nome, duracaoMin })

const CONFEITARIA = [t('Retirada de pedido', 15), t('Entrega', 30), t('Degustação', 60), t('Reunião', 30)]
const BELEZA = [t('Corte', 30), t('Barba', 30), t('Corte + barba', 60), t('Coloração', 90)]
const PETSHOP = [t('Banho', 60), t('Tosa', 60), t('Banho e tosa', 90), t('Consulta', 30)]
const SAUDE = [t('Consulta', 30), t('Retorno', 30), t('Avaliação', 60), t('Exame', 30)]
const SERVICOS = [t('Reunião', 60), t('Visita técnica', 60), t('Orçamento', 30)]
const LOJA = [t('Retirada', 15), t('Entrega', 30), t('Atendimento', 30)]
const RESTAURANTE = [t('Retirada de pedido', 15), t('Entrega', 30), t('Reserva de mesa', 60), t('Reunião', 30)]
export const GENERICOS = [t('Atendimento', 60), t('Reunião', 30), t('Retirada', 15), t('Entrega', 30)]

const POR_SEGMENTO: Record<string, ServiceTypeSeed[]> = {
  confeitaria: CONFEITARIA,
  restaurante: RESTAURANTE,
  beleza: BELEZA,
  barbearia: BELEZA,
  salao: BELEZA,
  petshop: PETSHOP,
  saude: SAUDE,
  clinica: SAUDE,
  servicos: SERVICOS,
  consultoria: SERVICOS,
  loja: LOJA,
}

/** Lista inicial do segmento (id do onboarding); desconhecido/"outro"/vazio -> genéricos. */
export function defaultServiceTypes(segmento?: string | null): ServiceTypeSeed[] {
  return POR_SEGMENTO[segmento ?? ''] ?? GENERICOS
}

/** Segmento de confeitaria (workspace de demonstração). */
export const SEGMENTO_DEMO = 'confeitaria'
