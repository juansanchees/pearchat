// Telefones dos contatos. A lógica (qualquer país, DDI padrão por espaço) mora em `@/lib/phone`, que também roda no navegador.
import { DEFAULT_DDI, normalizePhoneE164 } from '@/lib/phone'

export { formatPhoneDisplay, phoneCandidates, phoneVariants } from '@/lib/phone'

/**
 * Normaliza para E.164 ("+5511987654321"). Número com "+", "00" ou já com DDI nunca ganha DDI; número digitado SEM DDI
 * ganha `defaultDdi` (o DDI padrão do espaço; 55 quando não informado). Retorna null se o número for inválido.
 */
export function normalizePhone(raw: string, defaultDdi: string = DEFAULT_DDI): string | null {
  return normalizePhoneE164(raw, defaultDdi)
}
