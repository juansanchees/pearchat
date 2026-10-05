import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { sessionWorkspaceId } from '@/server/messages/api'
import {
  appBaseUrl,
  consumeState,
  encodeTokens,
  exchangeCodeChecked,
  googleConfigured,
  listCalendarsWithToken,
  readTokens,
} from '@/server/calendar/google'
import { invalidateGoogleCache } from '@/server/calendar/live'
import { DEFAULT_LEMBRETES, getConnection, logGoogleFailure, parseCalendarios } from '@/server/calendar/service'

export const dynamic = 'force-dynamic'

/** Motivos de falha devolvidos em /agenda?erro=... (a tela traduz em avisos amigáveis). */
type Motivo = 'negado' | 'estado' | 'sem_refresh' | 'sem_agendas' | 'permissao' | 'google'

/**
 * GET /api/calendar/google/callback?code=&state=
 * Consome o state (HMAC + validade + nonce de uso único) e confere que a sessão é do mesmo workspace,
 * troca o code, confere os escopos concedidos, lê as agendas reais, grava tokens criptografados e redireciona (sempre para um
 * caminho interno fixo) para /agenda?passo=agendas. Falhas: /agenda?erro=<motivo>, sem detalhes do Google.
 */
export async function GET(req: NextRequest) {
  const base = appBaseUrl(req.nextUrl.origin)
  const back = (q: string) => NextResponse.redirect(new URL(`/agenda?${q}`, base), 302)
  const fail = (m: Motivo) => back(`erro=${m}`)

  const sp = req.nextUrl.searchParams
  const code = sp.get('code')
  const state = sp.get('state')
  const googleError = sp.get('error')

  if (!state || !googleConfigured()) return fail('estado')

  try {
    // O state é sempre consumido (uso único), inclusive quando o usuário negou o acesso.
    const stateWorkspace = await consumeState(state)
    const sessionWorkspace = await sessionWorkspaceId()
    if (!stateWorkspace || !sessionWorkspace || stateWorkspace !== sessionWorkspace) return fail('estado')
    const workspaceId = sessionWorkspace

    if (googleError) return fail(googleError === 'access_denied' ? 'negado' : 'google')
    if (!code) return fail('google')

    // O Google deixa desmarcar permissões na tela de consentimento: sem as três, não conecta (nada é gravado).
    const result = await exchangeCodeChecked(code, base)
    if (!result.ok) {
      console.warn(`[calendar] callback: permissões não concedidas: ${result.faltando.join(',')}`)
      return fail('permissao')
    }
    const exchanged = result.exchanged
    const previous = await getConnection(workspaceId)

    // Sem refresh_token novo, só dá para seguir se já existe um da conexão anterior (reconexão).
    let refreshToken = exchanged.refreshToken
    if (!refreshToken && previous?.provider === 'google' && previous.tokens) {
      refreshToken = readTokens(previous.tokens)?.refreshToken ?? null
    }
    if (!refreshToken) return fail('sem_refresh')

    const found = await listCalendarsWithToken(exchanged.accessToken)
    if (found.length === 0) return fail('sem_agendas')
    const primary = found.find((c) => c.principal) ?? found[0]

    // Reconexão de uma conexão real mantém a seleção anterior; demo/nova usa o padrão.
    const prevSel = new Map(
      previous?.provider === 'google'
        ? parseCalendarios(previous.calendarios).map((c) => [c.id, c.selecionado] as const)
        : [],
    )
    const calendarios = found.map((c) => ({
      id: c.id,
      nome: c.nome,
      selecionado: prevSel.get(c.id) ?? (c.id === primary.id || c.papel === 'owner' || c.papel === 'writer'),
      principal: c.principal,
      papel: c.papel,
      cor: c.cor,
    }))
    const destinoId =
      previous?.provider === 'google' && previous.destinoId && found.some((c) => c.id === previous.destinoId)
        ? previous.destinoId
        : primary.id
    const tokens = encodeTokens({
      accessToken: exchanged.accessToken,
      refreshToken,
      expiresAt: exchanged.expiresAt,
      scopes: exchanged.scopes,
    })
    const now = new Date()

    await db.calendarConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        provider: 'google',
        email: primary.id,
        tokens,
        calendarios: calendarios.map((c) => ({ ...c, selecionado: c.id === destinoId ? true : c.selecionado })),
        destinoId,
        iaPodeAgendar: true,
        duracaoPadraoMin: 60,
        lembretes: DEFAULT_LEMBRETES,
        ultimaSyncEm: now,
      },
      update: {
        provider: 'google',
        email: primary.id,
        tokens,
        calendarios: calendarios.map((c) => ({ ...c, selecionado: c.id === destinoId ? true : c.selecionado })),
        destinoId,
        precisaReconectar: false,
        syncTokens: Prisma.DbNull, // tokens de sincronização antigos não valem para a nova autorização
        ultimaSyncEm: now,
      },
    })
    invalidateGoogleCache(workspaceId)
    return back('passo=agendas')
  } catch (err) {
    logGoogleFailure('callback', err)
    return fail('google')
  }
}
