// Tipos e opções das preferências do link de agendamento (compartilhados entre a rota e a tela do dono).

export const ANTECEDENCIAS = [30, 60, 120, 240, 1440] as const
export const DIAS_A_FRENTE = [7, 15, 30, 60] as const

export const ANTECEDENCIA_LABEL: Record<number, string> = {
  30: '30 minutos',
  60: '1 hora',
  120: '2 horas',
  240: '4 horas',
  1440: '24 horas',
}

export interface BookingSettingsDto {
  ativo: boolean
  slug: string | null
  /** Endereço completo quando há slug. */
  url: string | null
  /** Endereço sugerido (a partir do nome do negócio) enquanto não há slug. */
  slugSugerido: string
  /** Prefixo do endereço, para mostrar ao lado do campo de edição. */
  base: string
  antecedenciaMin: number
  diasAFrente: number
  mensagem: string
}
