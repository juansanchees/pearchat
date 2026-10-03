// Sessão expirada: qualquer chamada de API do cliente que volte 401 leva para o login.
// O caminho atual vai em ?callbackUrl= para a tela de login poder devolver o usuário onde ele estava.
let redirecting = false

export function redirectIfUnauthorized(status: number): void {
  if (status !== 401 || typeof window === 'undefined' || redirecting) return
  redirecting = true
  const here = window.location.pathname + window.location.search
  const back = here === '/' || here.startsWith('/login') ? '' : `?callbackUrl=${encodeURIComponent(here)}`
  window.location.assign(`/login${back}`)
}
