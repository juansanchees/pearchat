import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { db } from '@/lib/db'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'
import { defaultPrompt } from '@/server/agent/service'
import { ensureServiceTypes } from '@/server/calendar/service-types'
import { OBJETIVOS, SEGMENTOS } from './constants'
import { onboardingSchema as schema } from './schema'

export const dynamic = 'force-dynamic'

const TOM_DB = { Amigável: 'amigavel', Profissional: 'profissional', Direto: 'direto' } as const

/**
 * Salva o onboarding no workspace da sessão: nome da empresa, tamanho da equipe, nome e tom do agente e, só se o prompt do
 * agente ainda estiver vazio, um parágrafo inicial com segmento e objetivos.
 */
export async function POST(req: Request) {
  const deny = await denyUnless('settings.workspace'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, schema)
  if ('error' in body) return body.error
  const d = body.data

  try {
    await db.workspace.update({ where: { id: s.workspaceId }, data: { nome: d.empresa, tamanhoEquipe: d.tamanhoEquipe } })
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
    // Tipos de atendimento iniciais do segmento (só se o negócio ainda não tem nenhum).
    await ensureServiceTypes(s.workspaceId, d.segmento).catch(() => undefined)
    return NextResponse.json({ ok: true, promptSalvo })
  } catch {
    return fail('Não foi possível salvar agora. Tente de novo em instantes.', 500)
  }
}
