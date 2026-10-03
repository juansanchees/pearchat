import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { defaultPrompt } from '@/server/agent/service'
import { OBJETIVOS, SEGMENTOS } from './constants'

export const dynamic = 'force-dynamic'

const TOM_DB = { Amigável: 'amigavel', Profissional: 'profissional', Direto: 'direto' } as const

const schema = z.object({
  empresa: z.string().trim().min(1, 'Falta o nome da empresa').max(120),
  segmento: z.enum(Object.keys(SEGMENTOS) as [keyof typeof SEGMENTOS, ...(keyof typeof SEGMENTOS)[]]),
  objetivos: z.array(z.enum(Object.keys(OBJETIVOS) as [keyof typeof OBJETIVOS, ...(keyof typeof OBJETIVOS)[]])).max(4),
  agenteNome: z.string().trim().min(1, 'Dê um nome ao agente').max(60),
  tom: z.enum(['Amigável', 'Profissional', 'Direto']),
})

/**
 * Salva o onboarding no workspace da sessão: nome da empresa, nome e tom do agente e, só se o prompt do
 * agente ainda estiver vazio, um parágrafo inicial com segmento e objetivos. Tamanho da equipe não tem coluna.
 */
export async function POST(req: Request) {
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, schema)
  if ('error' in body) return body.error
  const d = body.data

  try {
    await db.workspace.update({ where: { id: s.workspaceId }, data: { nome: d.empresa } })
    const agent = await db.aiAgent.upsert({
      where: { workspaceId: s.workspaceId },
      create: { workspaceId: s.workspaceId, nome: d.agenteNome, tom: TOM_DB[d.tom] },
      update: { nome: d.agenteNome, tom: TOM_DB[d.tom] },
    })
    let promptSalvo = false
    if (!agent.prompt.trim()) {
      const objs = d.objetivos.map((o) => OBJETIVOS[o])
      const extra = `O negócio atua no segmento de ${SEGMENTOS[d.segmento]}.${objs.length ? ` Objetivos do atendimento: ${objs.join('; ')}.` : ''}`
      await db.aiAgent.update({ where: { id: agent.id }, data: { prompt: `${defaultPrompt(d.agenteNome, d.empresa)} ${extra}` } })
      promptSalvo = true
    }
    return NextResponse.json({ ok: true, promptSalvo })
  } catch {
    return fail('Não foi possível salvar agora. Tente de novo em instantes.', 500)
  }
}
