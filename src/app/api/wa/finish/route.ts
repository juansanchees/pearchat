import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { z } from 'zod'
import { getApiSession } from '@/server/whatsapp/auth'
import { applyHistoryChoice } from '@/server/whatsapp/meta-connect'
import { getSession, mergeSessionData, toStatusDTO } from '@/server/whatsapp/session'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ importarHistorico: z.boolean() })

// Passo 3 do fluxo oficial: guarda a preferência de importar o histórico.
export async function POST(req: Request) {
  const deny = await denyUnless('wa.manage'); if (deny) return deny
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  const { workspaceId } = session

  const row = await getSession(workspaceId)
  if (!row || row.status !== 'CONECTADO') {
    return NextResponse.json({ error: 'O WhatsApp ainda não está conectado' }, { status: 409 })
  }
  try {
    // API oficial real: grava a escolha e, na Coexistence, pede o histórico/contatos à Meta.
    if (row.provider === 'OFICIAL' && process.env.WA_MOCK !== 'true') {
      await applyHistoryChoice(workspaceId, parsed.data.importarHistorico)
      return NextResponse.json(toStatusDTO(await getSession(workspaceId)))
    }
    const sessionData = await mergeSessionData(workspaceId, { importarHistorico: parsed.data.importarHistorico })
    const updated = await db.whatsAppSession.update({ where: { workspaceId }, data: { sessionData } })
    return NextResponse.json(toStatusDTO(updated))
  } catch (e) {
    // No mock a ENCRYPTION_KEY pode estar vazia: a preferência simplesmente não é gravada.
    if (process.env.WA_MOCK === 'true') return NextResponse.json(toStatusDTO(row))
    console.error('[wa/finish]', e instanceof Error ? e.message : 'erro')
    return NextResponse.json({ error: 'Não foi possível salvar a preferência' }, { status: 500 })
  }
}
