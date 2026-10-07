// Resposta de GET /api/results?period=7|30|90 (consumida pelo drawer "Resultados").

export const PERIODOS = [7, 30, 90] as const
export type Periodo = (typeof PERIODOS)[number]

export interface ResultsDto {
  periodo: Periodo
  /** Primeiro e último dia do período (YYYY-MM-DD, fuso do espaço; o último é hoje). */
  de: string
  ate: string
  /** true = nada aconteceu no período em nenhum bloco. */
  vazio: boolean
  atendimento: {
    /** Conversas com ao menos uma mensagem no período. */
    conversas: number
    recebidas: number
    enviadas: number
    /** Mediana (segundos) entre a 1ª mensagem do cliente de cada sessão e a 1ª resposta nossa; null = sem dados. */
    primeiraRespostaMedianaSeg: number | null
    /** Quantas sessões entraram nesse cálculo. */
    sessoesMedidas: number
    /** Uma entrada por dia do período, em ordem. */
    porDia: { dia: string; recebidas: number }[]
  }
  ia: {
    /** Respostas da IA entregues (não conta avisos de passagem nem follow-ups). */
    respostas: number
    /** Conversas em que a IA respondeu ou passou para uma pessoa. */
    atendidas: number
    /** % das conversas atendidas pela IA que não precisaram de passagem; null = sem conversas. */
    semPassagemPct: number | null
    passagens: number
    passagensPorMotivo: { motivo: string; total: number }[]
  }
  agenda: {
    total: number
    porOrigem: { ia: number; manual: number; link: number }
    /** Top 5 tipos de atendimento. */
    porTipo: { tipo: string; total: number }[]
    /** Cancelados pelo cliente (pela IA, a pedido dele) no período. Não entram no total acima. */
    canceladosPeloCliente: number
    /** Presença confirmada pelo cliente (ou à mão) no período. */
    confirmados: number
    /** Responderam ao lembrete pedindo para remarcar, no período. */
    pediramRemarcar: number
  }
  disparos: {
    campanhas: number
    enviadas: number
    respostas: number
    taxaResposta: number | null
  }
  followup: {
    enviados: number
    /** Cliente respondeu em até 48 h do envio. */
    recuperados: number
    /** Enviados há menos de 48 h e ainda sem resposta: ficam fora da taxa. */
    aguardando: number
    taxaRecuperacao: number | null
  }
  /** Mensagens recebidas: picos[diaDaSemana 0=domingo..6][faixa 0=madrugada,1=manhã,2=tarde,3=noite]. */
  picos: number[][]
}
