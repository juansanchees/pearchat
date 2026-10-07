// Onda 1: "Testar o agente" (gasto de IA), link público de agendamento como canhão de spam e conta de demonstração.
// Rode com: node test-env.mjs -- npx tsx --test tests/security/abuse.test.ts   (schema de teste; nunca o de produção)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import bcrypt from 'bcryptjs'
import { cleanup, makeAccount, randomIp, uniq } from './helpers'
import { db } from '../../src/lib/db'
import { AGENT_TEST_BODY_LIMIT, AGENT_TEST_PER_ORG_DAY, AGENT_TEST_PER_USER_HOUR, hitAgentTestCaps } from '../../src/server/agent/limits'
import { agentTestSchema } from '../../src/server/agent/service'
import { addDaysStr, todayIn } from '../../src/server/booking/availability'
import {
  MAX_CONFIRMACOES_NOVOS_POR_HORA,
  MAX_LINK_POR_HORA,
  MSG_LINK_PAUSADO,
  avisarTeto,
  cabeConfirmacao,
  linkEstourado,
} from '../../src/server/booking/caps'
import { MAX_FUTUROS_POR_TELEFONE, createPublicBooking, getPublicWorkspace } from '../../src/server/booking/public'
import { hashPhone } from '../../src/server/booking/security'
import { linkPausado } from '../../src/server/booking/http'

after(cleanup)

const ROOT = path.resolve(__dirname, '..', '..')

// ---------------------------------------------------------------------------------------------------------------
describe('A4: "Testar o agente" tem teto por usuário e por organização', () => {
  it('os tetos documentados: 20 por usuário/hora, 100 por organização/dia, corpo de até 32 KB', () => {
    assert.equal(AGENT_TEST_PER_USER_HOUR, 20)
    assert.equal(AGENT_TEST_PER_ORG_DAY, 100)
    assert.equal(AGENT_TEST_BODY_LIMIT, 32 * 1024)
  })

  it('ATAQUE: o usuário que passa do teto horário é bloqueado (429 na rota) e o uso bloqueado não é contado', async () => {
    const u = await makeAccount({ verified: true })
    const limits = { perUserHour: 3, perOrgDay: 100 }
    for (let i = 0; i < 3; i++) assert.deepEqual(await hitAgentTestCaps(u.id, u.organizationId, limits), { blocked: false })
    const r = await hitAgentTestCaps(u.id, u.organizationId, limits)
    assert.equal(r.blocked, true)
    if (r.blocked) {
      assert.equal(r.cap, 'agent-test-user-hour')
      assert.ok(r.retryAfter >= 1)
    }
    // Outro usuário (de outra organização) não é afetado.
    const outro = await makeAccount({ verified: true })
    assert.deepEqual(await hitAgentTestCaps(outro.id, outro.organizationId, limits), { blocked: false })
  })

  it('ATAQUE: vários usuários da MESMA organização esbarram no teto diário da organização', async () => {
    const a = await makeAccount({ verified: true })
    const b = await makeAccount({ verified: true, orgId: a.organizationId })
    const c = await makeAccount({ verified: true, orgId: a.organizationId })
    const limits = { perUserHour: 100, perOrgDay: 4 }
    assert.equal((await hitAgentTestCaps(a.id, a.organizationId, limits)).blocked, false)
    assert.equal((await hitAgentTestCaps(b.id, a.organizationId, limits)).blocked, false)
    assert.equal((await hitAgentTestCaps(c.id, a.organizationId, limits)).blocked, false)
    assert.equal((await hitAgentTestCaps(a.id, a.organizationId, limits)).blocked, false)
    const r = await hitAgentTestCaps(b.id, a.organizationId, limits)
    assert.equal(r.blocked, true)
    if (r.blocked) assert.equal(r.cap, 'agent-test-org-day')
  })

  it('tamanho: mensagem de teste acima de 1000 caracteres e instruções acima de 4000 são recusadas', () => {
    assert.equal(agentTestSchema.safeParse({ mensagem: 'a'.repeat(1000) }).success, true)
    assert.equal(agentTestSchema.safeParse({ mensagem: 'a'.repeat(1001) }).success, false)
    assert.equal(agentTestSchema.safeParse({ mensagem: 'oi', prompt: 'p'.repeat(4001) }).success, false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
async function bookingSetup(opts: { whatsapp: boolean }) {
  const acc = await makeAccount({ verified: true })
  const slug = `t-${uniq()}`
  await db.workspace.update({ where: { id: acc.workspaceId }, data: { slug, bookingAtivo: true, bookingAntecedenciaMin: 0, bookingDiasAFrente: 30 } })
  const st = await db.serviceType.create({ data: { workspaceId: acc.workspaceId, nome: 'Corte', duracaoMin: 30, ordem: 1 } })
  if (opts.whatsapp) await db.whatsAppSession.create({ data: { workspaceId: acc.workspaceId, provider: 'RAPIDA', status: 'CONECTADO', numero: '5511999990000' } })
  const pub = await getPublicWorkspace(slug)
  assert.ok(pub, 'link público ativo')
  return { acc, st, pub, slug }
}
type Setup = Awaited<ReturnType<typeof bookingSetup>>

const phone = () => `119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const HORAS = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const dia = (n: number) => addDaysStr(todayIn(), n)

function book(s: Setup, i: number, over: { telefoneRaw?: string; ipHash?: string; date?: string } = {}) {
  return createPublicBooking({
    workspace: s.pub,
    serviceTypeId: s.st.id,
    date: over.date ?? dia(2),
    hora: HORAS[i % HORAS.length],
    nome: 'Cliente Teste',
    telefoneRaw: over.telefoneRaw ?? phone(),
    observacao: null,
    ipHash: over.ipHash ?? `ip-${uniq()}`,
    telefoneHash: (e164) => hashPhone(s.acc.workspaceId, e164),
  })
}

const outbound = (workspaceId: string) => db.message.count({ where: { conversation: { workspaceId }, direction: 'OUT' } })

describe('M2: teto por NEGÓCIO no link público de agendamento', () => {
  it('as constantes são as documentadas (20 agendamentos/h, 5 confirmações/h para número novo)', () => {
    assert.equal(MAX_LINK_POR_HORA, 20)
    assert.equal(MAX_CONFIRMACOES_NOVOS_POR_HORA, 5)
    assert.equal(MAX_FUTUROS_POR_TELEFONE, 3)
  })

  it('caminho feliz: agendamento pelo link funciona e conta no teto; sem WhatsApp conectado, não manda mensagem', async () => {
    const s = await bookingSetup({ whatsapp: false })
    const r = await book(s, 0)
    assert.equal(r.kind, 'ok')
    assert.equal(await db.bookingAttempt.count({ where: { workspaceId: s.acc.workspaceId } }), 1)
    assert.equal(await outbound(s.acc.workspaceId), 0)
  })

  it('ATAQUE (IPs rotativos): ao estourar o teto do negócio o link fica "indisponível no momento" e o dono é avisado UMA vez', async () => {
    const s = await bookingSetup({ whatsapp: false })
    const now = new Date()
    await db.bookingAttempt.createMany({
      data: Array.from({ length: MAX_LINK_POR_HORA }, (_, i) => ({ workspaceId: s.acc.workspaceId, ipHash: `ip-x-${i}`, telefoneHash: `tel-x-${i}`, createdAt: new Date(now.getTime() - i * 1000) })),
    })
    assert.equal(await db.$transaction((tx) => linkEstourado(tx, s.acc.workspaceId, now)), true)
    const r1 = await book(s, 1) // IP e telefone novos, mas o NEGÓCIO já passou do teto
    assert.deepEqual(r1, { kind: 'cap' })
    assert.equal(await db.event.count({ where: { workspaceId: s.acc.workspaceId } }), 0, 'nada foi agendado')
    assert.equal(await db.contact.count({ where: { workspaceId: s.acc.workspaceId } }), 0, 'nenhum contato inventado')
    await book(s, 2)
    await new Promise((r) => setTimeout(r, 1500)) // o aviso é disparado sem esperar
    assert.equal(await db.auditLog.count({ where: { organizationId: s.acc.organizationId, acao: 'booking.link_capped' } }), 1, 'aviso ao dono, no máximo 1 por hora')
    // A resposta HTTP da rota: 503 com a mensagem pedida e Retry-After.
    const http = linkPausado()
    assert.equal(http.status, 503)
    assert.ok(http.headers.get('retry-after'))
    assert.match(((await http.json()) as { message: string }).message, new RegExp(MSG_LINK_PAUSADO.slice(0, 30)))
  })

  it('o dono pode desativar o link: link desativado continua respondendo como inexistente', async () => {
    const s = await bookingSetup({ whatsapp: false })
    await db.workspace.update({ where: { id: s.acc.workspaceId }, data: { bookingAtivo: false } })
    assert.equal(await getPublicWorkspace(s.slug), null)
  })

  it('ATAQUE: no máximo 3 agendamentos futuros por telefone (o 4º é recusado)', async () => {
    const s = await bookingSetup({ whatsapp: false })
    const tel = phone()
    for (let i = 0; i < MAX_FUTUROS_POR_TELEFONE; i++) assert.equal((await book(s, i, { telefoneRaw: tel })).kind, 'ok')
    assert.equal((await book(s, 5, { telefoneRaw: tel })).kind, 'limit')
  })

  it('ATAQUE: o mesmo IP não faz mais de 5 agendamentos por hora (limite por IP continua valendo)', async () => {
    const s = await bookingSetup({ whatsapp: false })
    const ip = `ip-${uniq()}`
    for (let i = 0; i < 5; i++) assert.equal((await book(s, i, { ipHash: ip })).kind, 'ok')
    assert.equal((await book(s, 6, { ipHash: ip })).kind, 'limit')
  })

  it('ATAQUE: confirmações por WhatsApp a NÚMEROS NOVOS têm teto por negócio; o agendamento vale, mas sem mensagem', async () => {
    const s = await bookingSetup({ whatsapp: true })
    const ids: string[] = []
    for (let i = 0; i < MAX_CONFIRMACOES_NOVOS_POR_HORA; i++) {
      const r = await book(s, i)
      assert.equal(r.kind, 'ok')
      ids.push(r.kind === 'ok' ? r.eventId : '')
    }
    assert.equal(await outbound(s.acc.workspaceId), MAX_CONFIRMACOES_NOVOS_POR_HORA, 'até o teto, a confirmação sai')
    assert.equal(await cabeConfirmacao(s.acc.workspaceId, 2, new Date()), false, 'número novo: acabou o teto')
    const extra = await book(s, 9)
    assert.equal(extra.kind, 'ok', 'o agendamento em si vale')
    assert.equal(await outbound(s.acc.workspaceId), MAX_CONFIRMACOES_NOVOS_POR_HORA, 'mas nenhuma mensagem nova foi mandada a estranhos')
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(await db.auditLog.count({ where: { organizationId: s.acc.organizationId, acao: 'booking.link_capped' } }), 1, 'o dono foi avisado')
  })

  it('avisarTeto não lança sem organização e respeita 1 aviso por hora', async () => {
    const s = await bookingSetup({ whatsapp: false })
    await avisarTeto(s.acc.workspaceId, 'mensagens')
    await avisarTeto(s.acc.workspaceId, 'agendamentos')
    assert.equal(await db.auditLog.count({ where: { organizationId: s.acc.organizationId, acao: 'booking.link_capped' } }), 1)
    await avisarTeto('inexistente-' + randomIp(), 'mensagens')
  })
})

// ---------------------------------------------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', '.claude'].includes(name)) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Roda um script TypeScript em outro processo. Tenta de novo se o banco remoto recusar a conexão (o pooler é compartilhado). */
function runTs(file: string, args: string[], env: Record<string, string>) {
  let r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), file, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000 })
  for (let i = 0; i < 2 && r.status === 1 && /Can't reach database server/.test(r.stderr); i++) {
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)'])
    r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), file, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000 })
  }
  return r
}

describe('A3: conta de demonstração sem senha no repositório', () => {
  it('nenhuma senha de demonstração fixa em README, docs, prisma, scripts, src ou tests', () => {
    const needle = ['pearchat', '123'].join('') // montada aqui para este arquivo não se denunciar
    const hits = ['README.md', 'docs', 'prisma', 'scripts', 'src', 'tests']
      .flatMap((p) => {
        const full = path.join(ROOT, p)
        return statSync(full).isDirectory() ? walk(full) : [full]
      })
      .filter((f) => /\.(md|ts|tsx|mjs|js|json|sql|prisma|yml|yaml)$/.test(f) && readFileSync(f, 'utf8').includes(needle))
    assert.deepEqual(hits, [])
  })

  it('o seed se recusa a rodar com NODE_ENV=production (sem a flag explícita) ANTES de tocar no banco', () => {
    const r = runTs('prisma/seed.ts', [], { NODE_ENV: 'production', SEED_DEMO_PASSWORD: 'uma-senha-bem-longa-123', SEED_ALLOW_PRODUCTION: '', SEED_ALLOW_REMOTE: '1' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /Recusado: NODE_ENV=production/)
  })

  it('o seed se recusa a rodar contra um banco que não é local (sem a flag explícita)', () => {
    const r = runTs('prisma/seed.ts', [], { NODE_ENV: 'development', SEED_DEMO_PASSWORD: 'uma-senha-bem-longa-123', SEED_ALLOW_PRODUCTION: '', SEED_ALLOW_REMOTE: '', DATABASE_URL: 'postgresql://u:p@db.exemplo-remoto.invalid:5432/x?schema=pearchat_test_a' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /não aponta para uma máquina local/)
  })

  it('sem SEED_DEMO_PASSWORD o seed NÃO cria a conta demo e avisa (sem padrão)', () => {
    const before = db.user.count({ where: { email: 'mariana@doceatelie.com.br' } })
    const r = runTs('prisma/seed.ts', [], { NODE_ENV: 'development', SEED_DEMO_PASSWORD: '', SEED_ALLOW_REMOTE: '1' })
    assert.equal(r.status, 0)
    assert.match(r.stderr + r.stdout, /SEED_DEMO_PASSWORD ausente/)
    return before.then(async (n) => assert.equal(await db.user.count({ where: { email: 'mariana@doceatelie.com.br' } }), n))
  })

  it('rotate-demo-password: troca a senha de UMA conta (lida do ambiente, não impressa), derruba sessões e recusa senha fraca/argumento', async () => {
    const u = await makeAccount({ verified: true })
    const nova = `Nova-${uniq()}-Senha-Longa!`
    const antes = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { sessionVersion: true, passwordHash: true } })
    const outra = await makeAccount({ verified: true })
    const outraAntes = await db.user.findUniqueOrThrow({ where: { id: outra.id }, select: { passwordHash: true } })

    await db.$disconnect() // libera as conexões do processo de teste (reabrem sozinhas) enquanto os scripts rodam
    const fraca = runTs('scripts/rotate-demo-password.ts', [u.email], { ROTATE_PASSWORD: 'curta' })
    assert.equal(fraca.status, 2)
    const semEnv = runTs('scripts/rotate-demo-password.ts', [u.email], { ROTATE_PASSWORD: '' })
    assert.equal(semEnv.status, 2)
    const porArg = runTs('scripts/rotate-demo-password.ts', [u.email, nova], { ROTATE_PASSWORD: nova })
    assert.equal(porArg.status, 2, 'senha como argumento é recusada')
    const inexistente = runTs('scripts/rotate-demo-password.ts', [`nao-existe-${uniq()}@teste.local`], { ROTATE_PASSWORD: nova })
    assert.equal(inexistente.status, 1)

    const ok = runTs('scripts/rotate-demo-password.ts', [u.email], { ROTATE_PASSWORD: nova })
    assert.equal(ok.status, 0, ok.stderr)
    assert.ok(!ok.stdout.includes(nova) && !ok.stderr.includes(nova), 'a senha nunca é impressa')
    assert.ok(!ok.stdout.includes(u.email), 'o e-mail sai mascarado')
    const depois = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { sessionVersion: true, passwordHash: true } })
    assert.equal(await bcrypt.compare(nova, depois.passwordHash!), true)
    assert.equal(await bcrypt.compare(u.password, depois.passwordHash!), false, 'a senha antiga não vale mais')
    assert.equal(depois.sessionVersion, antes.sessionVersion + 1, 'sessões abertas caem')
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: outra.id }, select: { passwordHash: true } })).passwordHash, outraAntes.passwordHash, 'outras contas não são tocadas')
  })
})
