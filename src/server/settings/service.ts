import { z } from 'zod'
import { db } from '@/lib/db'
import { isAllowedDefaultDdi } from '@/lib/phone'
import { PLANS } from '@/lib/plans'
import { isAllowedTimezone } from '@/lib/timezone'
import { invalidateWorkspaceLocale, toLocale } from '@/server/workspace-locale'
import { spMonthKey } from '@/server/calendar/time'
import { getOrgScope, PLAN_SPACE_LIMIT } from '@/server/spaces/org'
import { PLAN_MEMBER_LIMIT } from '@/server/team/limits'

/** Equipe: pessoas ativas + convites pendentes (o que conta para o limite de pessoas do plano). */
async function teamSeatsUsed(organizationId: string | null): Promise<number> {
  if (!organizationId) return 1
  const [users, pend] = await Promise.all([
    db.user.count({ where: { organizationId, desativadoEm: null } }),
    db.invite.count({ where: { organizationId, aceitoEm: null, revogadoEm: null, expiraEm: { gt: new Date() } } }),
  ])
  return users + pend
}
import type { BillingDTO, SettingsDTO } from '@/lib/types'

export const NOTIF_OPCOES = ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído', 'Novo agendamento'] as const
export const NOTIF_PADRAO = ['Conversa sem resposta há 10 min', 'IA passou uma conversa para mim', 'Disparo concluído']
export const HORARIO_PADRAO = 'Seg a sáb, 8h às 18h'

export class SettingsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export const settingsSchema = z.object({
  nome: z.string().trim().min(1, 'Informe seu nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200),
  empresa: z.string().trim().min(1, 'Informe o nome da empresa').max(120),
  horarioAtendimento: z.string().trim().max(200),
  // Opcionais: um cliente antigo (aba aberta antes do deploy) não os envia, e o que está gravado fica como está.
  ddiPadrao: z
    .string()
    .trim()
    .refine(isAllowedDefaultDdi, 'DDI padrão inválido')
    .optional(),
  timezone: z
    .string()
    .trim()
    .refine(isAllowedTimezone, 'Fuso horário inválido')
    .optional(),
  notifs: z
    .array(z.enum(NOTIF_OPCOES))
    .max(NOTIF_OPCOES.length)
    .transform((a) => Array.from(new Set(a))),
})
export type SettingsInput = z.infer<typeof settingsSchema>

/**
 * Perfil + empresa + avisos. A foto de perfil fica fora daqui (POST/DELETE /api/me/avatar).
 */
export async function getSettings(userId: string, workspaceId: string): Promise<SettingsDTO> {
  const [user, ws] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { nome: true, email: true, notifs: true, createdAt: true, updatedAt: true } }),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true, horarioAtendimento: true, ddiPadrao: true, timezone: true } }),
  ])
  return {
    nome: user.nome,
    email: user.email,
    empresa: ws.nome,
    horarioAtendimento: ws.horarioAtendimento ?? HORARIO_PADRAO,
    ...toLocale(ws),
    // Usuário nunca editado (updatedAt ~ createdAt) e sem preferências: mostra os padrões da spec.
    notifs: user.notifs.length === 0 && user.updatedAt.getTime() - user.createdAt.getTime() < 2000 ? NOTIF_PADRAO : user.notifs,
  }
}

export async function updateSettings(userId: string, workspaceId: string, input: SettingsInput): Promise<SettingsDTO> {
  // O e-mail de login NÃO muda por aqui (tomada de conta com a sessão aberta por um instante): a troca exige a senha e a
  // confirmação por código enviado ao endereço novo, em POST /api/me/email (src/server/mail/email-change.ts).
  const cur = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })
  if (input.email !== cur.email.toLowerCase()) {
    throw new SettingsError('Para trocar o e-mail, use "Trocar e-mail" em Perfil: pedimos sua senha e confirmamos o endereço novo.', 400)
  }
  const [, ws] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { nome: input.nome, notifs: input.notifs } }),
    db.workspace.update({
      where: { id: workspaceId },
      data: {
        nome: input.empresa,
        horarioAtendimento: input.horarioAtendimento || null,
        // Mudar o fuso NÃO altera horário já gravado (são instantes UTC): só a exibição e os cálculos daqui para frente.
        ...(input.ddiPadrao ? { ddiPadrao: input.ddiPadrao } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
      select: { ddiPadrao: true, timezone: true },
    }),
  ])
  invalidateWorkspaceLocale(workspaceId)
  return { nome: input.nome, email: cur.email, empresa: input.empresa, horarioAtendimento: input.horarioAtendimento, notifs: input.notifs, ...toLocale(ws) }
}

// ---- Plano e pagamento ----

const PLANO_NOME = { ESSENCIAL: 'Essencial', PRO: 'Pro', NEGOCIOS: 'Negócios' } as const
/** Limites por plano (spec 04). null = ilimitado. Limite de contatos do Essencial não consta na spec: valor provisório. */
const LIMITES: Record<keyof typeof PLANO_NOME, BillingDTO['limites']> = {
  ESSENCIAL: { respostasIa: PLANS.ESSENCIAL.respostasIa, disparos: PLANS.ESSENCIAL.disparos, contatos: PLANS.ESSENCIAL.contatos },
  PRO: { respostasIa: PLANS.PRO.respostasIa, disparos: PLANS.PRO.disparos, contatos: PLANS.PRO.contatos },
  NEGOCIOS: { respostasIa: PLANS.NEGOCIOS.respostasIa, disparos: PLANS.NEGOCIOS.disparos, contatos: PLANS.NEGOCIOS.contatos },
}
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export const currentMonthKey = spMonthKey

/**
 * Leitura leve para o motor: plano da ORGANIZAÇÃO, limite de respostas de IA e uso do mês somado em todos os
 * WhatsApps (espaços) da organização. Sem organização (conta antiga), vale só o workspace.
 */
export async function getAiQuota(workspaceId: string): Promise<{ limite: number | null; usadas: number }> {
  const scope = await getOrgScope(workspaceId)
  const usage = await db.usageCounter.aggregate({
    where: { workspaceId: { in: scope.workspaceIds }, mes: spMonthKey() },
    _sum: { respostasIa: true },
  })
  return { limite: LIMITES[scope.plano].respostasIa, usadas: usage._sum.respostasIa ?? 0 }
}

export async function getBilling(workspaceId: string): Promise<BillingDTO> {
  const scope = await getOrgScope(workspaceId)
  const ids = scope.workspaceIds
  const [usage, contatos, invoices, espacos] = await Promise.all([
    db.usageCounter.aggregate({
      where: { workspaceId: { in: ids }, mes: currentMonthKey() },
      _sum: { mensagensAtendimento: true, respostasIa: true, disparos: true, transcricoesSeg: true },
    }),
    db.contact.count({ where: { workspaceId: { in: ids } } }),
    db.invoice.findMany({ where: { workspaceId: { in: ids } }, orderBy: { emitidaEm: 'desc' }, take: 12 }),
    db.workspace.count({ where: { id: { in: ids }, arquivadoEm: null } }),
  ])
  return {
    plano: PLANO_NOME[scope.plano],
    uso: {
      mensagensAtendimento: usage._sum.mensagensAtendimento ?? 0,
      respostasIa: usage._sum.respostasIa ?? 0,
      transcricoesSeg: usage._sum.transcricoesSeg ?? 0,
      disparos: usage._sum.disparos ?? 0,
      contatos,
    },
    limites: LIMITES[scope.plano],
    espacos: { usados: espacos, limite: PLAN_SPACE_LIMIT[scope.plano] },
    pessoas: { usados: await teamSeatsUsed(scope.organizationId), limite: PLAN_MEMBER_LIMIT[scope.plano] },
    faturas: invoices.map((i) => ({
      id: i.id,
      mes: `${MESES[i.emitidaEm.getMonth()]} ${i.emitidaEm.getFullYear()}`,
      valor: Number(i.valor),
      status: i.status,
      pdfUrl: i.pdfUrl,
    })),
  }
}
