import { db } from '@/lib/db'
import { audit } from '@/server/audit/log'
import { notifySpaceAttention } from '@/server/spaces/attention'

// Tetos POR NEGÓCIO do link público de agendamento (qualquer IP, qualquer telefone): impedem que o link vire canhão de
// spam (WhatsApp do negócio mandando mensagem a estranhos) ou lote a agenda com IPs rotativos.
export const MAX_LINK_POR_HORA = 20
export const MAX_LINK_POR_DIA = 80
/** Confirmações de WhatsApp disparadas pelo link (qualquer contato). Acima disso o agendamento vale, mas sem mensagem. */
export const MAX_CONFIRMACOES_POR_HORA = 15
export const MAX_CONFIRMACOES_POR_DIA = 60
/** Confirmações para NÚMEROS NOVOS (nunca falaram com o negócio): o canal de assédio, bem mais apertado. */
export const MAX_CONFIRMACOES_NOVOS_POR_HORA = 5
export const MAX_CONFIRMACOES_NOVOS_POR_DIA = 15

export const MSG_LINK_PAUSADO = 'Este link de agendamento está indisponível no momento. Tente novamente mais tarde.'

export const HORA_MS = 3_600_000
export const DIA_MS = 24 * HORA_MS

/** 0 = não enviou, 1 = para contato que já existia, 2 = para número novo. */
export const CONFIRMACAO = { NENHUMA: 0, EXISTENTE: 1, NOVO: 2 } as const

type Tx = Pick<typeof db, 'bookingAttempt'>

/** O negócio já passou do teto de agendamentos pelo link (por hora ou por dia)? Chamar dentro do lock do negócio. */
export async function linkEstourado(tx: Tx, workspaceId: string, now: Date): Promise<boolean> {
  const [hora, dia] = await Promise.all([
    tx.bookingAttempt.count({ where: { workspaceId, createdAt: { gte: new Date(now.getTime() - HORA_MS) } } }),
    tx.bookingAttempt.count({ where: { workspaceId, createdAt: { gte: new Date(now.getTime() - DIA_MS) } } }),
  ])
  return hora >= MAX_LINK_POR_HORA || dia >= MAX_LINK_POR_DIA
}

/** Ainda cabe uma confirmação de WhatsApp para este tipo de contato? */
export async function cabeConfirmacao(workspaceId: string, tipo: 1 | 2, now: Date): Promise<boolean> {
  const where = (ms: number) => ({ workspaceId, createdAt: { gte: new Date(now.getTime() - ms) }, confirmacaoWa: tipo === 2 ? CONFIRMACAO.NOVO : { gte: CONFIRMACAO.EXISTENTE } })
  const [hora, dia] = await Promise.all([db.bookingAttempt.count({ where: where(HORA_MS) }), db.bookingAttempt.count({ where: where(DIA_MS) })])
  if (tipo === 2) return hora < MAX_CONFIRMACOES_NOVOS_POR_HORA && dia < MAX_CONFIRMACOES_NOVOS_POR_DIA
  return hora < MAX_CONFIRMACOES_POR_HORA && dia < MAX_CONFIRMACOES_POR_DIA
}

/**
 * Avisa o dono (no máximo uma vez por hora por negócio) que o link atingiu o teto: registro na atividade da equipe
 * e o aviso em tempo real que os cartões dos espaços já usam. Nunca lança.
 */
export async function avisarTeto(workspaceId: string, motivo: 'agendamentos' | 'mensagens', now: Date = new Date()): Promise<void> {
  try {
    const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } })
    if (!ws?.organizationId) return
    const recente = await db.auditLog.findFirst({
      where: { organizationId: ws.organizationId, workspaceId, acao: 'booking.link_capped', createdAt: { gte: new Date(now.getTime() - HORA_MS) } },
      select: { id: true },
    })
    if (recente) return
    await audit({ organizationId: ws.organizationId, workspaceId, acao: 'booking.link_capped', meta: { motivo } })
    await notifySpaceAttention(workspaceId, {
      contato: 'clientes do link de agendamento',
      motivo:
        motivo === 'agendamentos'
          ? 'O link de agendamento atingiu o limite de segurança e ficou indisponível por um tempo. Confira os agendamentos recentes.'
          : 'O link de agendamento atingiu o limite de mensagens de confirmação: os novos agendamentos ficam sem mensagem automática por um tempo.',
    })
  } catch {
    // aviso é conveniência
  }
}
