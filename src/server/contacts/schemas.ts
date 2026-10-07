import { z } from 'zod'
import { cleanText } from '@/server/messages/api'
import { normalizeTags, parseFilterTag } from './tags'

export const DEFAULT_TAKE = 30
export const MAX_TAKE = 100

export const listQuerySchema = z.object({
  q: z
    .string()
    .max(300)
    .transform((v) => cleanText(v).trim().slice(0, 100))
    .default(''),
  tag: z
    .string()
    .trim()
    .max(20)
    .default('')
    .transform((v, ctx) => {
      if (!v) return null
      const tag = parseFilterTag(v)
      if (!tag) ctx.addIssue({ code: 'custom', message: 'Filtro de etiqueta inválido' })
      return tag
    }),
  cursor: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,60}$/, 'Cursor inválido')
    .optional(),
  take: z.coerce.number().int().min(1).max(MAX_TAKE).default(DEFAULT_TAKE),
})

const name = z.string().trim().min(1, 'Falta o nome').max(120)
// O telefone chega como texto; quem grava normaliza com o DDI padrão do espaço (normalizePhone(v, ddiPadrao)), porque o
// schema não conhece o espaço. Número com "+" ou já com DDI nunca ganha DDI.
const phone = z.string().trim().max(40, 'Telefone inválido')
const email = z
  .union([z.literal(''), z.string().trim().email('E-mail inválido').max(160)])
  .nullable()
  .transform((v) => (v ? v : null))
const tags = z.array(z.string().max(60)).max(30).transform(normalizeTags)
const address = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .transform((v) => (v ? v : null))
const birthday = z
  .string()
  .trim()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null
    // Só datas ISO (AAAA-MM-DD...) em um intervalo razoável; "2" ou o ano 275760 não são aniversários.
    const d = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(v) ? new Date(v) : new Date(NaN)
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2100) {
      ctx.addIssue({ code: 'custom', message: 'Aniversário inválido' })
    }
    return d
  })
const notes = z.string().max(2000)

export const createSchema = z.object({
  name,
  phone: phone.refine((v) => v !== '', 'Informe o WhatsApp do contato'),
  email: email.optional(),
  tags: tags.optional(),
  address: address.optional(),
  birthday: birthday.optional(),
  notes: notes.optional(),
})

export const patchSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    tags: tags.optional(),
    address: address.optional(),
    birthday: birthday.optional(),
    notes: notes.optional(),
    optOut: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para atualizar')

export type CreateInput = z.infer<typeof createSchema>
export type PatchInput = z.infer<typeof patchSchema>
