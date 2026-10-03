// Sessão expirada: qualquer chamada de API do cliente que volte 401 leva para o login.
let redirecting = false

export function redirectIfUnauthorized(status: number): void {
  if (status !== 401 || typeof window === 'undefined' || redirecting) return
  redirecting = true
  window.location.assign('/login')
}
