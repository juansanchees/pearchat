import { NextResponse } from 'next/server'
import { getApiSession } from '@/server/whatsapp/auth'
import { connectConfig, hostedSignupUrl } from '@/server/whatsapp/config'
import { assertOficialAllowed, ConnectError, createSignupState } from '@/server/whatsapp/meta-connect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Inicia o Cadastro incorporado: devolve um `state` de uso único (ligado ao usuário e ao workspace) e o link hospedado.
// O navegador pré-carrega o state para poder chamar FB.login direto no clique (sem popup bloqueado).
export async function POST() {
  const session = await getApiSession()
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const cfg = connectConfig()
  if (cfg.demo || !cfg.metaConfigured) return NextResponse.json({ error: 'A conexão oficial estará disponível em breve.' }, { status: 409 })
  try {
    await assertOficialAllowed(session.userId)
    const st = await createSignupState(session.workspaceId, session.userId, cfg.signupMode)
    return NextResponse.json({ state: st.id, expiresAt: st.expiraEm.toISOString(), mode: cfg.signupMode, hostedUrl: hostedSignupUrl() })
  } catch (e) {
    if (e instanceof ConnectError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[wa/embedded-signup/start]', e instanceof Error ? e.message : 'erro')
    return NextResponse.json({ error: 'Não foi possível iniciar o cadastro' }, { status: 500 })
  }
}
