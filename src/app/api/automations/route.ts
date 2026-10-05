import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { setDisparosAtivos } from '@/server/campaigns/service'
import { readJson } from '@/server/http/body'

const bodySchema = z.object({
  key: z.enum(['ia', 'disparos', 'followup']),
  on: z.boolean(),
})

// Liga/desliga uma automação do workspace. Desligar Disparos pausa as campanhas em andamento.
export async function PATCH(req: Request) {
  const deny = await denyUnless('automations.toggle'); if (deny) return deny
  const session = await auth()
  const workspaceId = session?.user?.workspaceId
  if (!workspaceId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const parsed = bodySchema.safeParse(await readJson(req))
  if (!parsed.success) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  const { key, on } = parsed.data

  if (on) {
    const wa = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { status: true } })
    if (wa?.status !== 'CONECTADO') {
      return NextResponse.json({ error: 'Conecte o WhatsApp primeiro' }, { status: 409 })
    }
  }

  if (key === 'ia') {
    await db.aiAgent.upsert({ where: { workspaceId }, create: { workspaceId, enabled: on }, update: { enabled: on } })
  } else if (key === 'followup') {
    await db.followUpRule.upsert({ where: { workspaceId }, create: { workspaceId, enabled: on }, update: { enabled: on } })
  } else {
    await setDisparosAtivos(workspaceId, on)
  }

  return NextResponse.json({ key, on })
}
