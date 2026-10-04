import { NextResponse } from 'next/server'
import { denyUnless } from '@/server/auth/guard'
import { getApiSession } from '@/server/whatsapp/auth'
import { connectConfig, hostedSignupUrl } from '@/server/whatsapp/config'
import { assertOficialAllowed, ConnectError, createSignupState } from '@/server/whatsapp/meta-connect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Inicia o Cadastro incorporado: devolve um `state` de uso único (ligado ao usuário e ao workspace) e o link hospedado.
// O navegador pré-carrega o state para poder chamar FB.login direto no clique (sem popup bloqueado).
export async function POST(req: Request) {
  const deny = await denyUnless('wa.manage'); if (deny) return deny
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  // Corpo opcional: { mode: 'sdk' | 'hosted' } (a tela pede 'hosted' quando o SDK do Facebook não carrega).
  let mode: 'sdk' | 'hosted' | undefined
  const raw = await req.text().catch(() => '')
  if (raw.trim()) {
    let body: unknown
    try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 }) }
    const m = body && typeof body === 'object' ? (body as { mode?: unknown }).mode : undefined
    if (m !== undefined && m !== 'sdk' && m !== 'hosted') return NextResponse.json({ error: 'Modo inválido' }, { status: 400 })
    mode = m
  }
  const cfg = connectConfig()
  if (cfg.demo || !cfg.metaConfigured) return NextResponse.json({ error: 'A conexão oficial estará disponível em breve.' }, { status: 409 })
  try {
    await assertOficialAllowed(session.userId)
    const st = await createSignupState(session.workspaceId, session.userId, mode ?? cfg.signupMode)
    return NextResponse.json({ state: st.id, expiresAt: st.expiraEm.toISOString(), mode: mode ?? cfg.signupMode, hostedUrl: hostedSignupUrl() })
  } catch (e) {
    if (e instanceof ConnectError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[wa/embedded-signup/start]', e instanceof Error ? e.message : 'erro')
    return NextResponse.json({ error: 'Não foi possível iniciar o cadastro' }, { status: 500 })
  }
}
