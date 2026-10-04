import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/auth.config'

const { auth } = NextAuth(authConfig)

// Páginas legais: públicas para todos (logado ou não), sem redirecionamento.
const OPEN_PAGES = ['/privacidade', '/termos', '/sessao-encerrada']
// /verificar-email exige sessão (o código vai para a conta logada).
const PUBLIC_PAGES = ['/login', '/registro', '/recuperar-senha', '/redefinir-senha', '/verificar-acesso']

export default auth((req) => {
  const { pathname } = req.nextUrl
  if (OPEN_PAGES.includes(pathname)) return NextResponse.next()
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
  // Exclui: /api/auth, /api/wa/* (webhooks), _next e arquivos estáticos.
  matcher: ['/((?!api/auth|api/wa|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
