import type { Metadata } from 'next'
import { auth } from '@/auth'
import { Onboarding } from '@/components/auth/onboarding'

export const metadata: Metadata = { title: 'PearChat · Primeiros passos' }

export default async function BemVindoPage() {
  const session = await auth()
  return <Onboarding nome={session?.user?.nome ?? session?.user?.name ?? ''} email={session?.user?.email ?? ''} />
}
