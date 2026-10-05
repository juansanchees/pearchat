import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SessionUnavailableError } from '@/server/auth/availability'

// Devolve a sessão do usuário (e o espaço/WhatsApp ATIVO dele) ou redireciona para /login.
// workspaceId = espaço ativo (sempre da organização do usuário); organizationId pode ser null só se o banco falhou.
export async function requireSession(): Promise<{ userId: string; workspaceId: string; organizationId: string | null; papel: string }> {
  const session = await auth()
  // Sessão revogada (sair de todos os dispositivos, troca de senha): tela própria, sem laço com o /login.
  if (session?.user?.invalid) redirect('/sessao-encerrada')
  // Banco sem resposta (erro transitório): NÃO é sessão inválida. Nada de /login nem de apagar o cookie: a tela de erro pede "tente de novo".
  if (session?.user?.unavailable) throw new SessionUnavailableError()
  const userId = session?.user?.userId
  const workspaceId = session?.user?.workspaceId
  if (!userId || !workspaceId) redirect('/login')
  return { userId, workspaceId, organizationId: session?.user?.organizationId ?? null, papel: session?.user?.papel ?? 'agent' }
}
