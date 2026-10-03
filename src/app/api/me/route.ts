import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import type { AppUser } from '@/components/app/app-state'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.userId
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { nome: true, email: true, fotoUrl: true, workspace: { select: { nome: true } } },
  })
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const me: AppUser = { nome: user.nome, email: user.email, empresa: user.workspace.nome, fotoUrl: user.fotoUrl }
  return NextResponse.json(me)
}
