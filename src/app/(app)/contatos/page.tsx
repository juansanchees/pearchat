import type { Metadata } from 'next'
import Contatos from '@/components/contatos/contatos'

export const metadata: Metadata = { title: 'PearChat · Contatos' }

export default function ContatosPage() {
  return <Contatos />
}
