import type { ServiceType } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { defaultServiceTypes } from './service-type-defaults'
import type { ServiceTypeDto } from './types'

export const toServiceTypeDto = (s: ServiceType): ServiceTypeDto => ({
  id: s.id,
  nome: s.nome,
  duracaoMin: s.duracaoMin,
  cor: s.cor,
  ordem: s.ordem,
})

/** Tipos ativos do workspace, na ordem definida pelo dono. */
export const listActiveServiceTypes = (workspaceId: string) =>
  db.serviceType.findMany({ where: { workspaceId, ativo: true }, orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }] })

/**
 * Se o workspace não tem nenhum tipo (nem inativo), cria os padrões do segmento (ou os genéricos).
 * Idempotente e seguro sob concorrência (skipDuplicates + unique [workspaceId, nome]).
 */
export async function ensureServiceTypes(workspaceId: string, segmento?: string | null): Promise<void> {
  const total = await db.serviceType.count({ where: { workspaceId } })
  if (total > 0) return
  await db.serviceType.createMany({
    data: defaultServiceTypes(segmento).map((s, i) => ({ workspaceId, nome: s.nome, duracaoMin: s.duracaoMin, ordem: i })),
    skipDuplicates: true,
  })
}

export const COR_RE = /^#[0-9a-fA-F]{6}$/
export const MSG_NOME_REPETIDO = 'Já existe um tipo com esse nome.'

export const duracaoSchema = z
  .number()
  .int()
  .min(5)
  .max(480)
  .refine((n) => n % 5 === 0, 'A duração deve ser múltiplo de 5 minutos')

/** Tipos ativos como texto para o prompt da IA: "Corte (30 min), Barba (30 min)". */
export async function serviceTypesForPrompt(workspaceId: string): Promise<{ nome: string; duracaoMin: number }[]> {
  const rows = await listActiveServiceTypes(workspaceId)
  return rows.map((r) => ({ nome: r.nome, duracaoMin: r.duracaoMin }))
}
