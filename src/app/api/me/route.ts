import { NextResponse } from 'next/server'
import { unauthorizedResponse } from '@/server/auth/availability'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import type { AppUser } from '@/components/app/app-state'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.userId
  if (!userId) return unauthorizedResponse()

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { nome: true, email: true, fotoUrl: true, image: true, workspace: { select: { nome: true, organization: { select: { nome: true } } } } },
  })
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const me: AppUser = { nome: user.nome, email: user.email, empresa: user.workspace.nome, organizacao: user.workspace.organization?.nome ?? user.workspace.nome, fotoUrl: user.fotoUrl ?? user.image, papel: session?.user?.papel, id: userId }
  return NextResponse.json(me)
}
