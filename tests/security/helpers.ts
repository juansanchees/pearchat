// Ajudantes dos testes de segurança da onda 1 (conta, autenticação, limites e abuso).
// Rodam contra um schema de TESTE do Postgres (pearchat_test_a). Nunca contra o schema de produção.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../../src/lib/db'

export const TEST_SCHEMA = new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema') ?? ''
assert.match(TEST_SCHEMA, /^pearchat_test_[a-z0-9_]+$/, 'rode apenas num schema de teste (pearchat_test_*)')

/** O ambiente tem serviço de e-mail (simulado)? `node test-env.mjs --mail` liga; sem a flag, não há serviço. */
export const MAIL_ON = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)

/** O banco de teste é um pooler remoto compartilhado: tenta de novo quando a conexão cai ou o pool esgota (erros transitórios). */
export async function retryDb<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const transient = /Can't reach database server|Timed out fetching a new connection|Transaction already closed/.test(e instanceof Error ? e.message : '')
      if (!transient || i >= tries) throw e
      await new Promise((r) => setTimeout(r, 1500 * i))
    }
  }
}

export const uniq = () => randomBytes(5).toString('hex')
export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

const created = { users: [] as string[], workspaces: [] as string[], orgs: [] as string[] }

export type TestUser = { id: string; email: string; password: string; workspaceId: string; organizationId: string }

/** Conta completa (organização + espaço + usuário). `verified` marca o e-mail como verificado. */
export async function makeAccount(opts: { password?: string | null; verified?: boolean; papel?: string; orgId?: string; workspaceId?: string; email?: string } = {}): Promise<TestUser> {
  const password = opts.password === null ? '' : (opts.password ?? 'Senha-Forte-1234')
  let organizationId = opts.orgId
  let workspaceId = opts.workspaceId
  if (!organizationId) {
    const org = await retryDb(() => db.organization.create({ data: { nome: `Org ${uniq()}` } }))
    organizationId = org.id
    created.orgs.push(org.id)
  }
  if (!workspaceId) {
    const ws = await retryDb(() => db.workspace.create({ data: { nome: `Negócio ${uniq()}`, organizationId } }))
    workspaceId = ws.id
    created.workspaces.push(ws.id)
  }
  const email = opts.email ?? `t-${uniq()}@teste.local`
  const passwordHash = opts.password === null ? null : await bcrypt.hash(password, 4)
  const u = await retryDb(() => db.user.create({
    data: {
      nome: 'Teste Segurança',
      email,
      passwordHash,
      papel: opts.papel ?? 'owner',
      workspaceId,
      organizationId,
      emailVerified: opts.verified ? new Date() : null,
    },
  }))
  created.users.push(u.id)
  return { id: u.id, email, password, workspaceId, organizationId }
}

export async function cleanup() {
  for (const id of created.users) {
    await db.verificationToken.deleteMany({ where: { identifier: { contains: id } } }).catch(() => undefined)
    await db.user.delete({ where: { id } }).catch(() => undefined)
  }
  for (const id of created.workspaces) await db.workspace.delete({ where: { id } }).catch(() => undefined)
  for (const id of created.orgs) {
    await db.auditLog.deleteMany({ where: { organizationId: id } }).catch(() => undefined)
    await db.organization.delete({ where: { id } }).catch(() => undefined)
  }
  await db.$disconnect()
}

/**
 * Captura os e-mails do modo simulado (MAIL_DRY_RUN grava "[mail][dry-run] para ***@dominio · "assunto"\n texto" no log).
 * Devolve a lista capturada e a função que restaura o console.
 */
export function captureMail() {
  const sent: Array<{ para: string; assunto: string; texto: string }> = []
  const orig = console.info
  console.info = (...args: unknown[]) => {
    const line = String(args[0] ?? '')
    const m = line.match(/^\[mail\]\[dry-run\] para (\S+) · "(.*?)"\n([\s\S]*)$/)
    if (m) sent.push({ para: m[1], assunto: m[2], texto: m[3] })
    else orig(...args)
  }
  return { sent, restore: () => void (console.info = orig) }
}

/** Código de 6 dígitos de um e-mail capturado (assunto "123456 é ..." ou texto com dígitos separados). */
export function codeFrom(mail: { assunto: string; texto: string }): string {
  const s = mail.assunto.match(/^(\d{6}) /)
  if (s) return s[1]
  const t = mail.texto.match(/(\d) (\d) (\d) (\d) (\d) (\d)/)
  assert.ok(t, 'e-mail sem código')
  return t.slice(1).join('')
}
