// Servidor custom: Next.js + Socket.io no mesmo processo HTTP.
//   dev:   tsx watch server.ts
//   prod:  tsx server.ts --prod   (após `next build`)
// Não funciona em serverless (precisa de um processo Node de longa duração).
import { createServer } from 'node:http'
import { parse } from 'node:url'
import { loadEnvConfig } from '@next/env'
import { Server } from 'socket.io'
import { getToken } from 'next-auth/jwt'
import { workspaceRoom } from '@/server/realtime/events'
import type { ClientToServerEvents, ServerToClientEvents } from '@/server/realtime/events'

const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production'
;(process.env as Record<string, string | undefined>).NODE_ENV = dev ? 'development' : 'production'
loadEnvConfig(process.cwd(), dev)

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOSTNAME_BIND ?? '0.0.0.0'

const COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

type SocketData = { workspaceId: string }

async function workspaceFromCookie(cookieHeader: string | undefined): Promise<string | null> {
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
  const workspaceId = token?.workspaceId
  return typeof workspaceId === 'string' && workspaceId ? workspaceId : null
}

async function main() {
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
      const workspaceId = await workspaceFromCookie(socket.handshake.headers.cookie)
      if (!workspaceId) return nextFn(new Error('unauthorized'))
      socket.data.workspaceId = workspaceId
      nextFn()
    } catch {
      nextFn(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    // O workspace vem SEMPRE do token validado, nunca do cliente.
    void socket.join(workspaceRoom(socket.data.workspaceId))
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
