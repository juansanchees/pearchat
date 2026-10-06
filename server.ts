// Servidor custom: Next.js + Socket.io no mesmo processo HTTP.
//   dev:   tsx watch server.ts
//   prod:  tsx server.ts --prod   (após `next build`)
// Não funciona em serverless (precisa de um processo Node de longa duração).
import { createServer } from 'node:http'
import { parse } from 'node:url'
import { loadEnvConfig } from '@next/env'
import { Server } from 'socket.io'
import { getToken } from 'next-auth/jwt'
import { assertProductionEnv } from '@/server/boot/guard'
import { attentionRoom, orgRoom, userRoom, workspaceRoom } from '@/server/realtime/events'
import type { ClientToServerEvents, ServerToClientEvents } from '@/server/realtime/events'
import { judgeHandshake, SOCKET_UNAUTHORIZED, SOCKET_UNAVAILABLE } from '@/server/realtime/handshake'

const dev = !process.argv.includes('--prod') && process.env.NODE_ENV !== 'production'
;(process.env as Record<string, string | undefined>).NODE_ENV = dev ? 'development' : 'production'
loadEnvConfig(process.cwd(), dev)
if (!dev) assertProductionEnv() // recusa subir em produção com mock, segredo fraco ou schema de teste (src/server/boot/guard.ts)

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOSTNAME_BIND ?? '0.0.0.0'

const COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

type SocketData = { workspaceId: string; organizationId: string; userId: string; papel: string }

// Carregada UMA vez no main() (depois do loadEnvConfig): evita compilar/importar no primeiro socket.
let resolveActive: (userId: string) => Promise<{ workspaceId: string; organizationId: string; sessionVersion: number; papel: string; blocked: boolean } | null> = async () => null
// Equipe: espaços liberados para atendentes (carregada no main()).
let agentSpaces: (userId: string) => Promise<string[]> = async () => []

type SocketSpace = { workspaceId: string; organizationId: string; userId: string; papel: string }

/**
 * Espaço do socket a partir do cookie de sessão. `unauthorized` = sem sessão ou resposta definitiva do banco (o cliente
 * não insiste); `unavailable` = o banco não respondeu agora (a sessão continua válida; o cliente tenta de novo).
 */
async function spaceFromCookie(cookieHeader: string | undefined): Promise<SocketSpace | typeof SOCKET_UNAUTHORIZED | typeof SOCKET_UNAVAILABLE> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!cookieHeader || !secret) return SOCKET_UNAUTHORIZED
  // Cookie de sessão pode estar em partes (.0, .1...) quando grande; o prefixo basta para detectar.
  const cookieName = COOKIE_NAMES.find((n) => cookieHeader.includes(`${n}=`) || cookieHeader.includes(`${n}.0=`))
  if (!cookieName) return SOCKET_UNAUTHORIZED
  const token = await getToken({
    req: { headers: { cookie: cookieHeader } },
    secret,
    cookieName,
    salt: cookieName,
    secureCookie: cookieName.startsWith('__Secure-'),
  })
  const userId = token?.userId
  if (typeof userId !== 'string' || !userId) return SOCKET_UNAUTHORIZED
  // O espaço ativo vem do BANCO (o token pode estar desatualizado depois de uma troca de WhatsApp) e é sempre
  // um workspace da organização do usuário. Sessão revogada (versão diferente), usuário desativado ou atendente sem
  // espaço liberado = recusa definitiva. Banco fora do ar = recusa TEMPORÁRIA (nada é autorizado sem conferir).
  const verdict = await judgeHandshake(() => resolveActive(userId), Number(token?.sessionVersion ?? 0))
  if (verdict.kind === SOCKET_UNAVAILABLE) {
    logLine('warn', 'socket-sessao-indisponivel', errInfo(verdict.error))
    return SOCKET_UNAVAILABLE
  }
  if (verdict.kind === SOCKET_UNAUTHORIZED) return SOCKET_UNAUTHORIZED
  const { active } = verdict
  return { workspaceId: active.workspaceId, organizationId: active.organizationId, userId, papel: active.papel }
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
      if (typeof space === 'string') return nextFn(new Error(space))
      socket.data.workspaceId = space.workspaceId
      socket.data.organizationId = space.organizationId
      socket.data.userId = space.userId
      socket.data.papel = space.papel
      nextFn()
    } catch (e) {
      // Falha inesperada (ex.: ao decodificar o cookie com o banco fora): temporária, o cliente tenta de novo.
      logLine('warn', 'socket-handshake-falhou', errInfo(e))
      nextFn(new Error(SOCKET_UNAVAILABLE))
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
  const { startEngine, stopEngine } = await import('@/server/engine/scheduler')
  const { db } = await import('@/lib/db')
  installShutdown(async () => {
    // 1) não aceita conexões novas; 2) motor: nada novo começa, espera o que está em andamento (até o prazo);
    // 3) fecha sockets e o pool do banco.
    httpServer.close()
    const r = await stopEngine(SHUTDOWN_GRACE_MS)
    logLine('info', 'motor-parado', r)
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await db.$disconnect()
  })

  await reconcileOnStartup()
  startEngine()

  httpServer.listen(port, hostname, () => {
    console.log(`> PearChat pronto em http://localhost:${port} (${dev ? 'dev' : 'produção'}, socket em /api/socket)`)
  })
}

// ---------------------------------------------------------------- Rede de segurança do processo

/** Prazo para o desligamento gracioso (o compose precisa de stop_grace_period MAIOR que isto + ~10 s). */
const SHUTDOWN_GRACE_MS = (() => {
  const n = Number(process.env.SHUTDOWN_GRACE_MS)
  if (process.env.SHUTDOWN_GRACE_MS && Number.isFinite(n) && n >= 0) return n
  return dev ? 3_000 : 25_000 // dev: o tsx watch reinicia a cada edição
})()
const processStart = new Date()

function logLine(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, area: 'processo', event, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

const errInfo = (e: unknown) => (e instanceof Error ? { erro: `${e.name}: ${e.message}`.slice(0, 300), stack: e.stack?.split('\n').slice(0, 6).join(' | ') } : { erro: String(e).slice(0, 300) })

let shuttingDown = false
let shutdownFn: (() => Promise<void>) | null = null

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logLine('info', 'desligando', { motivo: reason, prazoMs: SHUTDOWN_GRACE_MS })
  // Trava final: se algo pendurar, sai mesmo assim (antes do SIGKILL do Docker).
  const hard = setTimeout(() => {
    logLine('error', 'desligamento-forcado', { motivo: reason })
    process.exit(exitCode || 1)
  }, SHUTDOWN_GRACE_MS + 8_000)
  hard.unref()
  try {
    await shutdownFn?.()
  } catch (e) {
    logLine('error', 'falha-no-desligamento', errInfo(e))
  }
  logLine('info', 'desligado', { motivo: reason })
  process.exit(exitCode)
}

function installShutdown(fn: () => Promise<void>): void {
  shutdownFn = fn
}

process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
process.on('SIGINT', () => void shutdown('SIGINT', 0))
// Rejeição sem tratamento (ex.: um `void fn()` do motor que falhou): registra e SEGUE. Uma falha isolada do motor
// não pode derrubar sockets, webhooks e o agendador de todos os clientes.
process.on('unhandledRejection', (reason) => {
  logLine('error', 'rejeicao-sem-tratamento', errInfo(reason))
})
// Exceção síncrona sem tratamento: o estado do processo é desconhecido. Registra e sai LIMPO (desligamento gracioso,
// código 1); o Docker (restart: unless-stopped) sobe de novo e a subida reconcilia o que ficou pela metade.
process.on('uncaughtException', (err) => {
  logLine('error', 'excecao-sem-tratamento', errInfo(err))
  void shutdown('uncaughtException', 1)
})

/**
 * Subida: o que o processo anterior deixou pela metade volta para a fila com segurança.
 * - jobs de IA "executando" de antes desta subida (instância única) voltam a "pendente": a sendKey impede reenviar;
 * - a caixa de entrada dos webhooks é drenada (eventos gravados que não chegaram a ser processados).
 * ENGINE_SINGLE_INSTANCE=false desliga a retomada imediata (com várias instâncias vale só o prazo de job preso).
 */
async function reconcileOnStartup(): Promise<void> {
  if (process.env.ENGINE_DISABLED === 'true') return
  // Até 3 tentativas (oscilação do banco na subida). A drenagem tem teto de tempo: o que sobrar o agendador drena a
  // cada ciclo, e a subida não fica minutos sem atender HTTP.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (process.env.ENGINE_SINGLE_INSTANCE !== 'false') {
        const { recoverOrphanAiJobs } = await import('@/server/engine/ai-reply')
        await recoverOrphanAiJobs(processStart)
      }
      const { drainInbox } = await import('@/server/whatsapp/inbox')
      const deadline = Date.now() + 15_000
      const n = await drainInbox({ limit: 100, shouldStop: () => Date.now() > deadline })
      if (n > 0) logLine('info', 'caixa-de-entrada-drenada', { eventos: n })
      return
    } catch (e) {
      // Banco fora na subida: tenta de novo; depois disso o agendador (e o prazo de job preso) cuidam.
      logLine('warn', 'reconciliacao-na-subida-falhou', { tentativa: attempt, ...errInfo(e) })
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2_000))
    }
  }
}

main().catch((err) => {
  logLine('error', 'falha-na-subida', errInfo(err))
  process.exit(1)
})
