'use server'

import { signOut } from '@/auth'

// "Usar outro e-mail": sai da conta e volta ao cadastro.
export async function usarOutroEmailAction() {
  await signOut({ redirectTo: '/registro' })
}
