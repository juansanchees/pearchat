import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getApiSession } from '@/server/whatsapp/auth'
import { fetchBusinessToken, listPhoneNumbers } from '@/server/whatsapp/cloud-api'
import { connectConfig } from '@/server/whatsapp/config'
import { isGraphError } from '@/server/whatsapp/graph'
import { assertOficialAllowed, completeConnection, ConnectError, consumeSignupState, peekSignupState } from '@/server/whatsapp/meta-connect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ state: z.string().min(16).max(64), numero: z.string().min(8).max(40) })
const digits = (s: string) => s.replace(/\D/g, '')
const tail = (s: string) => digits(s).slice(-10)

// Cadastro hospedado pela Meta: não há retorno com `code`. O resultado chega pelo webhook account_update (PARTNER_ADDED)
// com a WABA e o portfólio. Esta rota (consultada pela tela a cada poucos segundos, ou pelo botão "Já concluí") procura
// um cadastro novo, busca o token do negócio e confere que o número informado pelo usuário é o da conta cadastrada.
export async function POST(req: Request) {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Digite o número do WhatsApp com DDD' }, { status: 400 })
  const { state, numero } = parsed.data
  const { workspaceId, userId } = session
  const cfg = connectConfig()
  if (cfg.demo || !cfg.metaConfigured) return NextResponse.json({ error: 'A conexão oficial estará disponível em breve.' }, { status: 409 })
  if (digits(numero).length < 10) return NextResponse.json({ error: 'Digite o número do WhatsApp com DDD' }, { status: 400 })

  try {
    await assertOficialAllowed(userId)
    const startedAt = await peekSignupState(state, workspaceId, userId)
    if (!startedAt) return NextResponse.json({ error: 'Esta tentativa expirou. Comece de novo.' }, { status: 403 })

    const events = await db.metaPartnerEvent.findMany({
      where: { claimedAt: null, createdAt: { gte: new Date(startedAt.getTime() - 2 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const seen = new Set<string>()
    for (const ev of events) {
      if (seen.has(ev.wabaId) || !ev.businessId) continue
      seen.add(ev.wabaId)
      let token: string
      let phoneId: string | undefined
      try {
        token = await fetchBusinessToken(ev.businessId)
        const phones = await listPhoneNumbers(ev.wabaId, token)
        phoneId = phones.find((p) => p.displayPhone && tail(p.displayPhone) === tail(numero))?.id
      } catch (e) {
        console.error(`[wa/hosted] consulta da conta falhou (${isGraphError(e) ? e.toLog() : 'erro'})`)
        continue
      }
      if (!phoneId) continue
      // Reivindica o cadastro (uma vez): outro workspace não consegue usar o mesmo evento.
      const claim = await db.metaPartnerEvent.updateMany({ where: { id: ev.id, claimedAt: null }, data: { claimedAt: new Date(), claimedByWorkspace: workspaceId } })
      if (claim.count !== 1) continue
      try {
        if (!(await consumeSignupState(state, workspaceId, userId))) throw new ConnectError('Esta tentativa expirou. Comece de novo.', 403)
        const dto = await completeConnection({
          workspaceId,
          token,
          wabaId: ev.wabaId,
          businessId: ev.businessId,
          phoneNumberId: phoneId,
          coexistence: false,
          registerUnlessConnected: true,
        })
        return NextResponse.json({ status: 'connected', dto })
      } catch (e) {
        // Falhou: devolve o cadastro à fila para uma nova tentativa.
        await db.metaPartnerEvent.updateMany({ where: { id: ev.id, claimedByWorkspace: workspaceId }, data: { claimedAt: null, claimedByWorkspace: null } })
        throw e
      }
    }
    return NextResponse.json({ status: 'waiting' })
  } catch (e) {
    if (e instanceof ConnectError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[wa/hosted]', isGraphError(e) ? e.toLog() : e instanceof Error ? e.message : 'erro')
    return NextResponse.json({ error: 'Não foi possível concluir a conexão com a Meta' }, { status: 502 })
  }
}
