import type { CobrancaInfo } from '@/lib/types'

// Textos e utilitários da cobrança no drawer "Plano e pagamento" (só usados com BILLING_ENABLED=true).

const ddmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const FORMAS = [
  { id: 'PIX', label: 'Pix' },
  { id: 'BOLETO', label: 'Boleto' },
  { id: 'CREDIT_CARD', label: 'Cartão' },
] as const
export type Forma = (typeof FORMAS)[number]['id']

export function cobrancaLabels(c: CobrancaInfo): { etiqueta: string; linha: string } {
  if (c.restrito && (c.status === 'trial' || c.status === 'pendente')) {
    return { etiqueta: 'Teste encerrado', linha: c.trialAte ? `Teste encerrado em ${ddmm(c.trialAte)}` : 'Teste encerrado' }
  }
  if (c.restrito && c.status === 'cancelada') return { etiqueta: 'Cancelada', linha: 'Assinatura encerrada' }
  switch (c.status) {
    case 'trial':
      return { etiqueta: 'Em teste', linha: c.trialAte ? `Teste até ${ddmm(c.trialAte)}` : 'Em teste' }
    case 'pendente':
      return { etiqueta: 'Aguardando pagamento', linha: c.trialDias && c.trialAte ? `Teste até ${ddmm(c.trialAte)}` : 'Aguardando pagamento' }
    case 'ativa':
      return { etiqueta: 'Ativa', linha: c.proximaCobranca ? `Renova em ${ddmm(c.proximaCobranca)}` : 'Ativa' }
    case 'atrasada':
      return { etiqueta: 'Em atraso', linha: 'Pagamento em atraso' }
    case 'cancelada':
      return { etiqueta: 'Cancelada', linha: c.proximaCobranca && new Date(c.proximaCobranca) > new Date() ? `Acesso até ${ddmm(c.proximaCobranca)}` : 'Cancelada' }
    default:
      return { etiqueta: 'Isenta', linha: 'Conta isenta de cobrança' }
  }
}

export function faturaStatus(s: string): string {
  if (s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH') return 'Pago'
  if (s === 'OVERDUE') return 'Atrasada'
  if (s === 'REFUNDED') return 'Estornada'
  return 'Pendente'
}

/** Abre a página hospedada do Asaas. Só https (ou localhost em modo de demonstração). */
export function openInvoice(url: string | null | undefined): boolean {
  if (!url) return false
  const demo = process.env.NEXT_PUBLIC_WA_MOCK === 'true' && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)
  if (!url.startsWith('https://') && !demo) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

export const fmtDia = ddmm
