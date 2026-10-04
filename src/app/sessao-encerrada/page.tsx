import type { Metadata } from 'next'
import { SessionInvalid } from '@/components/app/session-invalid'

export const metadata: Metadata = { title: 'PearChat · Sessão encerrada', robots: { index: false } }

// Destino de quem tinha uma sessão revogada ("sair de todos os dispositivos", troca de senha): limpa o cookie e volta ao login.
export default function SessaoEncerradaPage() {
  return <SessionInvalid />
}
