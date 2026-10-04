import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { db } from '@/lib/db'
import { LlmError } from '@/server/agent/llm'
import { agentTestSchema, testAgent } from '@/server/agent/service'
import { apiSession, fail, parseBody, unauthorized } from '@/server/settings/http'

export const dynamic = 'force-dynamic'

// Testa o agente com uma mensagem de cliente. Sem chave de IA, devolve a resposta simulada (simulado: true).
export async function POST(req: Request) {
  const deny = await denyUnless('agent.manage'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  const body = await parseBody(req, agentTestSchema)
  if ('error' in body) return body.error
  const user = await db.user.findUnique({ where: { id: s.userId }, select: { nome: true } })
  try {
    return NextResponse.json(await testAgent(s.workspaceId, user?.nome ?? '', body.data))
  } catch (e) {
    if (e instanceof LlmError) return fail('Não foi possível consultar a IA agora. Tente novamente.', 502)
    throw e
  }
}
