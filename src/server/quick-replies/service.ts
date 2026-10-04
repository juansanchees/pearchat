import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { DEFAULT_QUICK_REPLIES, parseAtalho, QR_MAX_PER_SPACE, QR_TEXTO_MAX } from '@/lib/quick-replies'
import type { QuickReplyDTO, QuickReplyList } from '@/lib/quick-replies'

export class QuickReplyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const atalhoField = z.string().max(40, 'Atalho muito longo').transform((v, ctx) => {
  const r = parseAtalho(v)
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.error })
    return z.NEVER
  }
  return r.atalho
})
const textoField = z
  .string()
  .max(QR_TEXTO_MAX + 2000, 'Texto grande demais')
  .transform((v) => v.trim())
  .pipe(z.string().min(1, 'Escreva o texto da resposta').max(QR_TEXTO_MAX, `O texto aceita até ${QR_TEXTO_MAX} caracteres.`))
const tituloField = z
  .string()
  .max(200)
  .transform((v) => v.trim())
  .pipe(z.string().max(80, 'O título aceita até 80 caracteres.'))
  .nullish()
  .transform((v) => v || null)

export const createSchema = z.object({ atalho: atalhoField, texto: textoField, titulo: tituloField })
export const updateSchema = z
  .object({ atalho: atalhoField.optional(), texto: textoField.optional(), titulo: tituloField.optional() })
  .refine((v) => v.atalho !== undefined || v.texto !== undefined || v.titulo !== undefined, 'Nada para alterar')
export const orderSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(QR_MAX_PER_SPACE) })

const select = { id: true, atalho: true, titulo: true, texto: true, ordem: true, usos: true } as const
const toDTO = (r: { id: string; atalho: string; titulo: string | null; texto: string; ordem: number; usos: number }): QuickReplyDTO => ({
  id: r.id,
  atalho: r.atalho,
  titulo: r.titulo,
  texto: r.texto,
  ordem: r.ordem,
  usos: r.usos,
})

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
const DUP = 'Já existe uma resposta com esse atalho.'

/** Lista do espaço; num espaço sem nenhuma, cria o conjunto inicial neutro. */
export async function listQuickReplies(workspaceId: string): Promise<QuickReplyList> {
  let rows = await db.quickReply.findMany({ where: { workspaceId }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }], select })
  if (rows.length === 0) {
    await db.quickReply.createMany({
      data: DEFAULT_QUICK_REPLIES.map((d, i) => ({ workspaceId, atalho: d.atalho, texto: d.texto, ordem: i })),
      skipDuplicates: true,
    })
    rows = await db.quickReply.findMany({ where: { workspaceId }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }], select })
  }
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { nome: true, horarioAtendimento: true } })
  return { items: rows.map(toDTO), vars: { empresa: ws?.nome ?? '', horario: ws?.horarioAtendimento?.trim() ?? '' } }
}

export async function createQuickReply(workspaceId: string, input: z.infer<typeof createSchema>): Promise<QuickReplyDTO> {
  const count = await db.quickReply.count({ where: { workspaceId } })
  if (count >= QR_MAX_PER_SPACE) throw new QuickReplyError(`Limite de ${QR_MAX_PER_SPACE} respostas rápidas por WhatsApp.`, 409)
  const last = await db.quickReply.aggregate({ where: { workspaceId }, _max: { ordem: true } })
  try {
    const row = await db.quickReply.create({
      data: { workspaceId, atalho: input.atalho, texto: input.texto, titulo: input.titulo, ordem: (last._max.ordem ?? -1) + 1 },
      select,
    })
    return toDTO(row)
  } catch (e) {
    if (isUnique(e)) throw new QuickReplyError(DUP, 409)
    throw e
  }
}

export async function updateQuickReply(workspaceId: string, id: string, input: z.infer<typeof updateSchema>): Promise<QuickReplyDTO> {
  const own = await db.quickReply.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (!own) throw new QuickReplyError('Resposta não encontrada', 404)
  try {
    const row = await db.quickReply.update({
      where: { id },
      data: { ...(input.atalho !== undefined && { atalho: input.atalho }), ...(input.texto !== undefined && { texto: input.texto }), ...(input.titulo !== undefined && { titulo: input.titulo }) },
      select,
    })
    return toDTO(row)
  } catch (e) {
    if (isUnique(e)) throw new QuickReplyError(DUP, 409)
    throw e
  }
}

export async function deleteQuickReply(workspaceId: string, id: string): Promise<void> {
  const r = await db.quickReply.deleteMany({ where: { id, workspaceId } })
  if (r.count === 0) throw new QuickReplyError('Resposta não encontrada', 404)
}

/** Reordena: `ids` precisa ser exatamente o conjunto de respostas do espaço (sem repetir, sem estranhos). */
export async function reorderQuickReplies(workspaceId: string, ids: string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new QuickReplyError('Lista de ordem inválida', 400)
  const mine = await db.quickReply.findMany({ where: { workspaceId }, select: { id: true } })
  if (mine.length !== ids.length || !mine.every((m) => ids.includes(m.id))) throw new QuickReplyError('Lista de ordem inválida', 400)
  await db.$transaction(ids.map((id, i) => db.quickReply.updateMany({ where: { id, workspaceId }, data: { ordem: i } })))
}

export async function markQuickReplyUsed(workspaceId: string, id: string): Promise<void> {
  const r = await db.quickReply.updateMany({ where: { id, workspaceId }, data: { usos: { increment: 1 } } })
  if (r.count === 0) throw new QuickReplyError('Resposta não encontrada', 404)
}
