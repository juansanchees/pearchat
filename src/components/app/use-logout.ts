'use client'

import { useCallback, useState } from 'react'
import { signOut } from 'next-auth/react'
import { closeSocket } from '@/lib/socket-client'

/** Sair da conta: encerra o tempo real, apaga a sessão e volta ao login. */
export function useLogout() {
  const [leaving, setLeaving] = useState(false)
  const logout = useCallback(async () => {
    if (leaving) return
    setLeaving(true)
    closeSocket()
    try {
      await signOut({ callbackUrl: '/login' })
    } catch {
      setLeaving(false)
    }
  }, [leaving])
  return { logout, leaving }
}
