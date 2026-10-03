import { z } from 'zod'
import { db } from '@/lib/db'
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
  notifs: z.array(z.enum(NOTIF_OPCOES)).max(NOTIF_OPCOES.length),
})
export type SettingsInput = z.infer<typeof settingsSchema>

/**
 * Perfil + empresa + avisos. A foto de perfil fica fora daqui.
 * TODO(foto): ainda não há storage de arquivos; a foto continua só no navegador (use-photo-picker) e
 * User.fotoUrl não é gravado. Quando houver storage (S3/Supabase Storage), subir o arquivo e salvar a URL aqui.
 */
export async function getSettings(userId: string, workspaceId: string): Promise<SettingsDTO> {
  const [user, ws] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { nome: true, email: true, notifs: true, createdAt: true, updatedAt: true } }),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { nome: true, horarioAtendimento: true } }),
  ])
  return {
    nome: user.nome,
    email: user.email,
    empresa: ws.nome,
    horarioAtendimento: ws.horarioAtendimento ?? HORARIO_PADRAO,
    // Usuário nunca editado (updatedAt ~ createdAt) e sem preferências: mostra os padrões da spec.
    notifs: user.notifs.length === 0 && user.updatedAt.getTime() - user.createdAt.getTime() < 2000 ? NOTIF_PADRAO : user.notifs,
  }
}

export async function updateSettings(userId: string, workspaceId: string, input: SettingsInput): Promise<SettingsDTO> {
  const dup = await db.user.findFirst({ where: { email: input.email, NOT: { id: userId } }, select: { id: true } })
  if (dup) throw new SettingsError('Este e-mail já está em uso', 409)
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { nome: input.nome, email: input.email, notifs: input.notifs } }),
    db.workspace.update({ where: { id: workspaceId }, data: { nome: input.empresa, horarioAtendimento: input.horarioAtendimento || null } }),
  ])
  return { nome: input.nome, email: input.email, empresa: input.empresa, horarioAtendimento: input.horarioAtendimento, notifs: input.notifs }
}

// ---- Plano e pagamento ----

const PLANO_NOME = { ESSENCIAL: 'Essencial', PRO: 'Pro', NEGOCIOS: 'Negócios' } as const
/** Limites por plano (spec 04). null = ilimitado. Limite de contatos do Essencial não consta na spec: valor provisório. */
const LIMITES: Record<keyof typeof PLANO_NOME, BillingDTO['limites']> = {
  ESSENCIAL: { respostasIa: 500, disparos: 1000, contatos: 1000 },
  PRO: { respostasIa: 3000, disparos: 10000, contatos: 5000 },
  NEGOCIOS: { respostasIa: null, disparos: null, contatos: null },
}
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function getBilling(workspaceId: string): Promise<BillingDTO> {
  const [ws, usage, contatos, invoices] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { plano: true } }),
    db.usageCounter.findUnique({ where: { workspaceId_mes: { workspaceId, mes: currentMonthKey() } } }),
    db.contact.count({ where: { workspaceId } }),
    db.invoice.findMany({ where: { workspaceId }, orderBy: { emitidaEm: 'desc' }, take: 12 }),
  ])
  return {
    plano: PLANO_NOME[ws.plano],
    uso: {
      mensagensAtendimento: usage?.mensagensAtendimento ?? 0,
      respostasIa: usage?.respostasIa ?? 0,
      disparos: usage?.disparos ?? 0,
      contatos,
    },
    limites: LIMITES[ws.plano],
    faturas: invoices.map((i) => ({
      id: i.id,
      mes: `${MESES[i.emitidaEm.getMonth()]} ${i.emitidaEm.getFullYear()}`,
      valor: Number(i.valor),
      status: i.status,
      pdfUrl: i.pdfUrl,
    })),
  }
}
