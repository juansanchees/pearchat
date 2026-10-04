import { NextResponse } from 'next/server'
import type { GateFail } from './pending'

// Respostas HTTP padronizadas dos pedidos "Responder com a IA" (uma conversa, devolver para a IA e lote).

const FAIL: Record<GateFail | 'NADA_A_RESPONDER' | 'MODO_HUMANO' | 'LOTE_EM_ANDAMENTO', string> = {
  IA_DESLIGADA: 'O agente de IA está desligado. Ligue-o para responder as conversas.',
  WHATSAPP_DESCONECTADO: 'O WhatsApp está desconectado.',
  ASSINATURA_INATIVA: 'A assinatura está inativa: a IA não pode responder agora.',
  COTA_ESGOTADA: 'O limite de respostas de IA do plano deste mês foi atingido.',
  NADA_A_RESPONDER: 'Esta conversa não está esperando resposta.',
  MODO_HUMANO: 'Esta conversa está em atendimento humano. Devolva para a IA primeiro.',
  LOTE_EM_ANDAMENTO: 'Já há respostas da IA em andamento. Aguarde terminar para pedir mais.',
}

export function pendingFail(code: keyof typeof FAIL, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: FAIL[code], code, ...extra }, { status: 409 })
}
