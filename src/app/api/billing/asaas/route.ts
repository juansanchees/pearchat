import { NextResponse } from 'next/server'
import { readTextLimited } from '@/server/http/body'
import { handleAsaasEvent, tokenOk } from '@/server/billing/webhook'
import type { AsaasEvent } from '@/server/billing/webhook'

export const dynamic = 'force-dynamic'

const MAX_BODY = 256 * 1024

// Webhook do Asaas (cadastre https://<domínio>/api/billing/asaas com o mesmo token de ASAAS_WEBHOOK_TOKEN).
// Sem sessão: a autenticação é o cabeçalho asaas-access-token. Ausente/errado = 401 sem executar nada.
export async function POST(req: Request) {
  if (!tokenOk(req.headers.get('asaas-access-token'))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const text = await readTextLimited(req, MAX_BODY).catch(() => '') // streaming com teto: corpo chunked não enche a memória
  if (!text) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  let evt: AsaasEvent
  try {
    evt = JSON.parse(text) as AsaasEvent
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!evt || typeof evt !== 'object') return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  const r = await handleAsaasEvent(evt)
  return NextResponse.json(r.body, { status: r.status })
}
