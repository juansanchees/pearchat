import { cookies } from 'next/headers'

export type AuthFormState = { error?: string; fieldErrors?: Partial<Record<string, string>> } | undefined

// Sem "manter conectado": o cookie de sessão passa a ser de sessão (some ao fechar o navegador).
export function makeSessionCookieNonPersistent() {
  const jar = cookies()
  for (const c of jar.getAll()) {
    if (!/authjs\.session-token(\.\d+)?$/.test(c.name)) continue
    jar.set(c.name, c.value, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: c.name.startsWith('__Secure-'),
    })
  }
}
