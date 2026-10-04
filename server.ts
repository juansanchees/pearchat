// Servidor custom: Next.js + Socket.io no mesmo processo HTTP.
//   dev:   tsx watch server.ts
//   prod:  tsx server.ts --prod   (após `next build`)
// Não funciona em serverless (precisa de um processo Node de longa duração).
import { createServer } from 'node:http'
import { parse } from 'node:url'
import { loadEnvConfig } from '@next/env'
import { Server } from 'socket.io'
import { getToken } from 'next-auth/jwt'
import { attentionRoom, orgRoom, userRoom, workspaceRoom } from '@/server/realtime/events'
import type { ClientToServerEvents, ServerToClientEvents } from '@/server/realtime/events'

const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production'
;(process.env as Record<string, string | undefined>).NODE_ENV = dev ? 'development' : 'production'
loadEnvConfig(process.cwd(), dev)

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOSTNAME_BIND ?? '0.0.0.0'

const COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

type SocketData = { workspaceId: string; organizationId: string; userId: string; papel: string }

// Carregada UMA vez no main() (depois do loadEnvConfig): evita compilar/importar no primeiro socket.
let resolveActive: (userId: string) => Promise<{ workspaceId: string; organizationId: string; sessionVersion: number; papel: string; blocked: boolean } | null> = async () => null
// Equipe: espaços liberados para atendentes (carregada no main()).
let agentSpaces: (userId: string) => Promise<string[]> = async () => []

async function spaceFromCookie(cookieHeader: string | undefined): Promise<{ workspaceId: string; organizationId: string; userId: string; papel: string } | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!cookieHeader || !secret) return null
  // Cookie de sessão pode estar em partes (.0, .1...) quando grande; o prefixo basta para detectar.
  const cookieName = COOKIE_NAMES.find((n) => cookieHeader.includes(`${n}=`) || cookieHeader.includes(`${n}.0=`))
  if (!cookieName) return null
  const token = await getToken({
    req: { headers: { cookie: cookieHeader } },
    secret,
    cookieName,
    salt: cookieName,
    secureCookie: cookieName.startsWith('__Secure-'),
  })
  const userId = token?.userId
  if (typeof userId !== 'string' || !userId) return null
  // O espaço ativo vem do BANCO (o token pode estar desatualizado depois de uma troca de WhatsApp) e é sempre
  // um workspace da organização do usuário. O import é tardio porque o db só pode carregar depois do loadEnvConfig.
  try {
    const active = await resolveActive(userId)
    // Sessão revogada ("sair de todos os dispositivos"): a versão do token não bate com a do banco.
    if (active && (token?.sessionVersion ?? 0) !== active.sessionVersion) return null
    // Equipe: usuário desativado / atendente sem espaço liberado não abre socket.
    if (active?.blocked) return null
    return active ? { workspaceId: active.workspaceId, organizationId: active.organizationId, userId, papel: active.papel } : null
  } catch {
    // Banco fora do ar / migração ainda não aplicada: NEGA (sem o banco não dá para conferir papel nem espaço).
    return null
  }
}

async function main() {
  resolveActive = (await import('@/server/spaces/org')).resolveActiveSpace
  const access = await import('@/server/team/access')
  agentSpaces = async (userId) => (await access.allowedWorkspaceIds(userId, 'agent')) ?? []
  const { default: next } = await import('next')
  const app = next({ dev, hostname: 'localhost', port })
  const handle = app.getRequestHandler()
  await app.prepare()

  const httpServer = createServer((req, res) => {
    handle(req, res, parse(req.url ?? '/', true))
  })

  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    path: '/api/socket',
    // Deixa o Next tratar outros upgrades (HMR do dev).
    destroyUpgrade: false,
  })

  io.use(async (socket, nextFn) => {
    try {
      const space = await spaceFromCookie(socket.handshake.headers.cookie)
      if (!space) return nextFn(new Error('unauthorized'))
      socket.data.workspaceId = space.workspaceId
      socket.data.organizationId = space.organizationId
      socket.data.userId = space.userId
      socket.data.papel = space.papel
      nextFn()
    } catch {
      nextFn(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    // O espaço vem SEMPRE do token validado + banco, nunca do cliente. Eventos completos só da sala do espaço
    // ATIVO; a sala da organização só recebe avisos leves (space.attention) dos outros WhatsApps.
    void socket.join(workspaceRoom(socket.data.workspaceId))
    void socket.join(userRoom(socket.data.userId))
    if (socket.data.papel === 'agent') {
      // Equipe: atendente só recebe avisos dos espaços em que é membro (nunca a sala da organização).
      void agentSpaces(socket.data.userId).then((ids) => ids.forEach((id) => void socket.join(attentionRoom(id))))
    } else if (socket.data.organizationId) {
      void socket.join(orgRoom(socket.data.organizationId))
    }
  })

  const { setIo } = await import('@/server/realtime/emit')
  setIo(io)

  // Motor de automações (IA, disparos, follow-up, lembretes). ENGINE_DISABLED=true desliga.
  const { startEngine } = await import('@/server/engine/scheduler')
  startEngine()

  httpServer.listen(port, hostname, () => {
    console.log(`> PearChat pronto em http://localhost:${port} (${dev ? 'dev' : 'produção'}, socket em /api/socket)`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
