import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/auth.config'
import { apiGuardVerdict } from '@/server/http/api-guard'

const { auth } = NextAuth(authConfig)

// Páginas legais: públicas para todos (logado ou não), sem redirecionamento.
const OPEN_PAGES = ['/privacidade', '/termos', '/sessao-encerrada']
// /verificar-email exige sessão (o código vai para a conta logada).
const PUBLIC_PAGES = ['/login', '/registro', '/recuperar-senha', '/redefinir-senha', '/verificar-acesso']

export default auth((req) => {
  const { pathname } = req.nextUrl
  if (OPEN_PAGES.includes(pathname)) return NextResponse.next()
  // Link público de agendamento: página e API sem login (o cliente final não tem conta).
  if (pathname.startsWith('/a/') || pathname.startsWith('/api/public/')) return NextResponse.next()
  // Convite da equipe: página pública (quem recebe ainda não tem conta; a página e o token fazem a conferência).
  if (pathname.startsWith('/convite/')) return NextResponse.next()
  // Rotas /api autenticadas: origem própria nas que mudam estado (CSRF) e 413 para corpo grande declarado.
  if (pathname.startsWith('/api/')) {
    const verdict = apiGuardVerdict(req)
    if (verdict) return NextResponse.json({ error: verdict.error }, { status: verdict.status })
  }
  const isPublic = PUBLIC_PAGES.includes(pathname)
  const loggedIn = !!req.auth

  // Página inicial do site: visitante vê a apresentação (estática); quem está logado vai direto para o app.
  if (pathname === '/') return loggedIn ? NextResponse.redirect(new URL('/whatsapp', req.nextUrl)) : NextResponse.next()

  if (!loggedIn && pathname.startsWith('/api/')) {
    // Chamadas fetch esperam JSON, não o HTML da tela de login.
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  if (!loggedIn && !isPublic) {
    const url = new URL('/login', req.nextUrl)
    const back = pathname + req.nextUrl.search
    if (back !== '/') url.searchParams.set('callbackUrl', back)
    return NextResponse.redirect(url)
  }
  if (loggedIn && isPublic) {
    return NextResponse.redirect(new URL('/', req.nextUrl))
  }
  return NextResponse.next()
})

export const config = {
  // Exclui: /api/auth, os webhooks (/api/wa/evolution, /api/wa/meta, /api/billing/asaas: cada um se autentica sozinho), _next e
  // arquivos estáticos. As demais rotas /api/wa/* (conectar, desconectar...) são do app e passam pela conferência de origem.
  matcher: ['/((?!api/auth|api/wa/evolution|api/wa/meta|api/billing/asaas|api/health|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
