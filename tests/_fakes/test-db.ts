// Apoio dos testes que usam o banco: SÓ roda num schema de TESTE (pearchat_test_*), cria negócios/telefones inventados
// e isola cada arquivo de teste do que sobrou de execuções anteriores no mesmo schema. Nenhum dado de cliente.
// Origem: .claude/tmp/hardtest-a/lib.ts (createBiz, newPhone, captureEvents).
import assert from 'node:assert/strict'
import { db } from '../../src/lib/db'
import { instanceNameFor } from '../../src/server/whatsapp/evolution'

export { db }

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Recusa rodar fora de um schema pearchat_test_* (confere a URL E o banco). */
export async function assertTestSchema(): Promise<string> {
  const urlSchema = new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema') ?? ''
  assert.match(urlSchema, /^pearchat_test_[a-z0-9_]+$/, 'DATABASE_URL precisa apontar para um schema de teste (pearchat_test_*)')
  const r = (await db.$queryRawUnsafe('select current_schema() as s')) as { s: string }[]
  const s = r[0]?.s ?? ''
  assert.equal(s, urlSchema, 'current_schema() diferente do schema da URL')
  return s
}

/**
 * Isola este arquivo de teste: o agendador processa o schema inteiro, então nada que sobrou de execuções anteriores pode
 * ser enviado/processado (sessões desconectadas, jobs finalizados, eventos de webhook pendentes descartados).
 */
export async function isolateSchema(): Promise<void> {
  await assertTestSchema()
  await db.whatsAppSession.updateMany({ where: { status: { not: 'DESCONECTADO' } }, data: { status: 'DESCONECTADO' } })
  await db.aiJob.updateMany({ where: { status: { in: ['pendente', 'executando'] } }, data: { status: 'feito', error: 'limpo pelo teste' } })
  await db.followUpJob.updateMany({ where: { status: { in: ['pendente', 'executando'] } }, data: { status: 'cancelado' } })
  await db.webhookInbox.updateMany({ where: { processedAt: null, deadAt: null }, data: { deadAt: new Date(), lastError: 'limpo pelo teste' } })
  await db.message.updateMany({ where: { status: 'PENDENTE', direction: 'OUT' }, data: { status: 'FALHOU', failReason: 'limpo pelo teste' } })
}

let seq = 0
export const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`

let phoneSeq = 0
/** Celular brasileiro inventado e único (+55 11 9xxxx-xxxx). */
export const newPhone = () => `+55119${String(Date.now()).slice(-5)}${String(phoneSeq++ % 1000).padStart(3, '0')}`.slice(0, 14)
export const digits = (phone: string) => phone.replace(/\D/g, '')
export const jidOf = (phone: string) => `${digits(phone)}@s.whatsapp.net`

export type BizOpts = {
  nome?: string
  enabled?: boolean
  connected?: boolean
  followUp?: boolean
  disparos?: boolean
  handoffRules?: string[]
  provider?: 'RAPIDA' | 'OFICIAL'
}

const created: string[] = []

/** Negócio de teste: workspace, dono, agente de IA (sempre), sessão da conexão rápida CONECTADA com a instância da Evolution. */
export async function createBiz(o: BizOpts = {}) {
  const tag = uid()
  const ws = await db.workspace.create({ data: { nome: o.nome ?? `Teste onda1 ${tag}`, plano: 'NEGOCIOS', disparosAtivos: o.disparos ?? true } })
  created.push(ws.id)
  await db.user.create({ data: { workspaceId: ws.id, nome: 'Mariana Teste', email: `t-${tag}@onda1.test`, passwordHash: 'x', papel: 'owner' } })
  await db.aiAgent.create({ data: { workspaceId: ws.id, enabled: o.enabled ?? true, nome: 'Luna', tom: 'amigavel', prompt: '', horario: 'sempre', handoffRules: o.handoffRules ?? [] } })
  if (o.followUp !== undefined) await db.followUpRule.create({ data: { workspaceId: ws.id, enabled: o.followUp } })
  if (o.connected !== false) {
    await db.whatsAppSession.create({
      data: { workspaceId: ws.id, provider: o.provider ?? 'RAPIDA', status: 'CONECTADO', numero: '+5511900000000', evolutionInstance: instanceNameFor(ws.id), connectedAt: new Date(Date.now() - 3_600_000) },
    })
  }
  return { workspaceId: ws.id, instance: instanceNameFor(ws.id) }
}

/**
 * Apaga os negócios criados por este processo (cascata: conversas, mensagens, jobs). Nunca lança: com o banco fora,
 * o `after` ainda precisa fechar os servidores falsos (senão o processo de teste não termina).
 */
export async function cleanupBiz(): Promise<void> {
  try {
    if (created.length) await db.workspace.deleteMany({ where: { id: { in: created } } })
    created.length = 0
  } catch (e) {
    console.error(`[teste] limpeza dos negócios de teste falhou (${e instanceof Error ? e.message.trim().slice(-160) : 'erro'})`)
  }
}

export async function convOf(workspaceId: string, phone: string) {
  return db.conversation.findFirst({ where: { workspaceId, contact: { telefone: phone } }, include: { contact: true } })
}

export const msgsOf = (conversationId: string) => db.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
export const jobsOf = (conversationId: string) => db.aiJob.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } })

/** Faz os jobs pendentes do workspace vencerem agora (pula o debounce). */
export async function makeDue(workspaceId: string): Promise<void> {
  await db.aiJob.updateMany({ where: { workspaceId, status: 'pendente' }, data: { runAt: new Date(Date.now() - 1000) } })
}

/** Espera `fn` devolver algo "verdadeiro" (ou estoura o prazo com a última leitura no erro). */
export async function waitFor<T>(fn: () => Promise<T>, opts: { timeoutMs?: number; everyMs?: number; what?: string } = {}): Promise<T> {
  const until = Date.now() + (opts.timeoutMs ?? 15_000)
  let last: T | undefined
  for (;;) {
    last = await fn()
    if (last) return last
    if (Date.now() > until) throw new Error(`tempo esgotado esperando ${opts.what ?? 'condição'} (última leitura: ${JSON.stringify(last)})`)
    await sleep(opts.everyMs ?? 200)
  }
}

/** Captura os eventos emitidos aos workspaces (substitui o socket.io global). */
export function captureEvents() {
  const events: { room: string; event: string; payload: unknown }[] = []
  const holder = globalThis as unknown as { __pearchat_io?: unknown }
  holder.__pearchat_io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ room, event, payload })
        return true
      },
    }),
  }
  return events
}
