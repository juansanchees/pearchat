import { z } from 'zod'
import { OBJETIVOS, SEGMENTOS, TAMANHOS_EQUIPE } from './constants'

// Corpo aceito por POST /api/onboarding (fica fora de route.ts para os testes importarem sem tocar no banco).
export const onboardingSchema = z.object({
  empresa: z.string().trim().min(1, 'Falta o nome da empresa').max(120),
  segmento: z.enum(Object.keys(SEGMENTOS) as [keyof typeof SEGMENTOS, ...(keyof typeof SEGMENTOS)[]]),
  objetivos: z.array(z.enum(Object.keys(OBJETIVOS) as [keyof typeof OBJETIVOS, ...(keyof typeof OBJETIVOS)[]])).max(4),
  agenteNome: z.string().trim().min(1, 'Dê um nome ao agente').max(60),
  tom: z.enum(['Amigável', 'Profissional', 'Direto']),
  tamanhoEquipe: z.enum(TAMANHOS_EQUIPE, { message: 'Escolha o tamanho da equipe' }),
})
