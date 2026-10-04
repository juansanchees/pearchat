// Servidor custom: Next.js + Socket.io no mesmo processo HTTP.
//   dev:   tsx watch server.ts
//   prod:  tsx server.ts --prod   (após `next build`)
// Não funciona em serverless (precisa de um processo Node de longa duração).
import { createServer } from 'node:http'
import { parse } from 'node:url'
import { loadEnvConfig } from '@next/env'
import { Server } from 'socket.io'
import { getToken } from 'next-auth/jwt'
import { orgRoom, workspaceRoom } from '@/server/realtime/events'
import type { ClientToServerEvents, ServerToClientEvents } from '@/server/realtime/events'

const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production'
;(process.env as Record<string, string | undefined>).NODE_ENV = dev ? 'development' : 'production'
loadEnvConfig(process.cwd(), dev)

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOSTNAME_BIND ?? '0.0.0.0'

const COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

type SocketData = { workspaceId: string; organizationId: string }

// Carregada UMA vez no main() (depois do loadEnvConfig): evita compilar/importar no primeiro socket.
let resolveActive: (userId: string) => Promise<{ workspaceId: string; organizationId: string; sessionVersion: number } | null> = async () => null

async function spaceFromCookie(cookieHeader: string | undefined): Promise<{ workspaceId: string; organizationId: string } | null> {
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
    return active ? { workspaceId: active.workspaceId, organizationId: active.organizationId } : null
  } catch {
    // Banco fora do ar / migração ainda não aplicada: usa o que o token traz.
    const workspaceId = token?.workspaceId
    return typeof workspaceId === 'string' && workspaceId
      ? { workspaceId, organizationId: typeof token?.organizationId === 'string' ? token.organizationId : '' }
      : null
  }
}

async function main() {
  resolveActive = (await import('@/server/spaces/org')).resolveActiveSpace
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
      nextFn()
    } catch {
      nextFn(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    // O espaço vem SEMPRE do token validado + banco, nunca do cliente. Eventos completos só da sala do espaço
    // ATIVO; a sala da organização só recebe avisos leves (space.attention) dos outros WhatsApps.
    void socket.join(workspaceRoom(socket.data.workspaceId))
    if (socket.data.organizationId) void socket.join(orgRoom(socket.data.organizationId))
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
