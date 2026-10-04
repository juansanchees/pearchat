import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { apiSession, unauthorized } from '@/server/settings/http'
import { getBilling } from '@/server/settings/service'

export const dynamic = 'force-dynamic'

// Plano atual, uso do mês e faturas. Troca de plano e de cartão ainda não existem (sem gateway).
export async function GET() {
  const deny = await denyUnless('billing.view'); if (deny) return deny
  const s = await apiSession()
  if (!s) return unauthorized()
  return NextResponse.json(await getBilling(s.workspaceId))
}
