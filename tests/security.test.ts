// Testes de segurança do login (rodam contra um schema de TESTE do Postgres; ver tests/README em .claude/tmp).
// Uso: tsx --test tests/security.test.ts   (com DATABASE_URL apontando para o schema de teste)
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '../src/lib/db'
import { totpAt, base32Encode } from '../src/server/security/totp'
import { reserve, markSuccess } from '../src/server/security/rate-limit'
import { primaryLogin, secondFactorLogin } from '../src/server/security/login'
import { beginSetup, confirmSetup, disableMfa, regenerateRecovery, readChallenge } from '../src/server/security/mfa'

const schema = new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema')
assert.equal(schema, 'pearchat_test_e', 'rode apenas no schema de teste')

const uniq = () => randomBytes(5).toString('hex')
const created: string[] = []
async function makeUser(password = 'Senha-Forte-1') {
  const email = `t-${uniq()}@teste.local`
  const u = await db.user.create({
    data: { nome: 'Teste', email, passwordHash: await bcrypt.hash(password, 4), workspace: { create: { nome: 'Teste' } } },
  })
  created.push(u.id)
  return { id: u.id, email, password }
}
after(async () => {
  for (const id of created) {
    const u = await db.user.findUnique({ where: { id }, select: { workspaceId: true } })
    await db.user.delete({ where: { id } }).catch(() => undefined)
    if (u) await db.workspace.delete({ where: { id: u.workspaceId } }).catch(() => undefined)
  }
  await db.$disconnect()
})

describe('TOTP (vetores do RFC 6238, SHA-1, 6 dígitos)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ]
  for (const [t, code] of vectors) it(`t=${t}`, () => assert.equal(totpAt(secret, t * 1000), code))
})

describe('limite de tentativas', () => {
  const T0 = Date.UTC(2026, 9, 4, 12, 0, 0)

  it('bloqueia o e-mail após 5 falhas, libera após 15 min e zera no sucesso', async () => {
    const email = `rl-${uniq()}@teste.local`
    const ip = `10.0.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`
    for (let i = 0; i < 5; i++) assert.equal((await reserve('login', { email, ip }, T0 + i * 1000)).blocked, false)
    const sixth = await reserve('login', { email, ip }, T0 + 6000)
    assert.equal(sixth.blocked, true)
    // O bloqueio não se prorroga com as tentativas bloqueadas: 15 min depois da 1ª falha já libera.
    assert.equal((await reserve('login', { email, ip }, T0 + 15 * 60_000 - 1000)).blocked, true)
    assert.equal((await reserve('login', { email, ip }, T0 + 15 * 60_000 + 1000)).blocked, false)
    // Outro e-mail, mesmo IP: não é afetado pelo limite do e-mail.
    assert.equal((await reserve('login', { email: `outro-${uniq()}@teste.local`, ip }, T0 + 20 * 60_000)).blocked, false)
    // Sucesso zera o contador do e-mail.
    const email2 = `rl-${uniq()}@teste.local`
    for (let i = 0; i < 4; i++) await reserve('login', { email: email2, ip: `10.9.9.${i}` }, T0)
    await markSuccess('login', { email: email2, ip: '10.9.9.9' }, T0 + 1000)
    for (let i = 0; i < 5; i++) assert.equal((await reserve('login', { email: email2, ip: '10.8.8.8' }, T0 + 2000 + i)).blocked, false)
  })

  it('bloqueia o IP após 30 falhas (e-mails diferentes) e libera depois', async () => {
    const ip = `10.1.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`
    for (let i = 0; i < 30; i++) assert.equal((await reserve('login', { email: `ip${i}-${uniq()}@teste.local`, ip }, T0 + i)).blocked, false)
    const r = await reserve('login', { email: `novo-${uniq()}@teste.local`, ip }, T0 + 100)
    assert.equal(r.blocked, true)
    assert.equal((await reserve('login', { email: `novo-${uniq()}@teste.local`, ip }, T0 + 15 * 60_000 + 1000)).blocked, false)
  })

  it('guarda só hashes (nenhum e-mail ou IP em claro)', async () => {
    const email = `claro-${uniq()}@teste.local`
    await reserve('login', { email, ip: '203.0.113.77' })
    const rows = await db.loginAttempt.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
    for (const r of rows) assert.match(r.emailHash, /^[0-9a-f]{64}$/), assert.match(r.ipHash, /^[0-9a-f]{64}$/)
  })
})

describe('login e verificação em duas etapas', () => {
  const ip = () => `172.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  const base = Date.now()
  let tick = 0
  const nextNow = () => base + 31_000 * ++tick * 3 // sempre um passo de 30 s novo, bem à frente

  it('senha errada e e-mail inexistente respondem igual; sem 2FA devolve o usuário', async () => {
    const u = await makeUser()
    const a = await primaryLogin(u.email, 'errada-errada', ip(), { delay: false })
    const b = await primaryLogin(`nao-existe-${uniq()}@teste.local`, 'qualquer-coisa', ip(), { delay: false })
    assert.deepEqual(a, { kind: 'invalid' })
    assert.deepEqual(b, { kind: 'invalid' })
    const ok = await primaryLogin(u.email, u.password, ip(), { delay: false })
    assert.equal(ok.kind, 'ok')
  })

  it('fluxo completo: ativar, desafio, código errado, replay, recuperação de uso único, desativar', async () => {
    const u = await makeUser()
    const setup = await beginSetup(u.id)
    // Antes de confirmar o código, o 2FA ainda NÃO vale no login.
    assert.equal((await primaryLogin(u.email, u.password, ip(), { delay: false })).kind, 'ok')
    const t1 = nextNow()
    assert.rejects(confirmSetup(u.id, '000000', t1))
    const recovery = await confirmSetup(u.id, totpAt(setup.secret, t1), t1)
    assert.equal(recovery.length, 10)

    // O segredo está criptografado em repouso e os códigos de recuperação só existem como hash.
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.ok(row.totpSecret?.startsWith('v1:') && !row.totpSecret.includes(setup.secret))
    const hashes = await db.recoveryCode.findMany({ where: { userId: u.id } })
    assert.equal(hashes.length, 10)
    for (const h of hashes) assert.ok(!recovery.some((c) => h.codeHash.includes(c.replace('-', ''))))

    // Senha certa com 2FA: só um desafio, nenhuma sessão.
    const first = await primaryLogin(u.email, u.password, ip(), { delay: false })
    assert.equal(first.kind, 'mfa')
    if (first.kind !== 'mfa') return
    assert.equal(readChallenge(first.challenge)?.u, u.id)

    // Código errado.
    const t2 = nextNow()
    assert.deepEqual(await secondFactorLogin(first.challenge, '123456', ip(), { now: t2, delay: false }), { kind: 'invalid' })
    // Código certo entra; o mesmo desafio não vale de novo (uso único).
    const good = totpAt(setup.secret, t2)
    const ok = await secondFactorLogin(first.challenge, good, ip(), { now: t2, delay: false })
    assert.equal(ok.kind, 'ok')
    assert.equal((await secondFactorLogin(first.challenge, recovery[9], ip(), { now: t2, delay: false })).kind, 'expired')

    // Replay: o mesmo código TOTP, num desafio novo, é recusado.
    const second = await primaryLogin(u.email, u.password, ip(), { delay: false })
    assert.equal(second.kind, 'mfa')
    if (second.kind !== 'mfa') return
    assert.deepEqual(await secondFactorLogin(second.challenge, good, ip(), { now: t2, delay: false }), { kind: 'invalid' })

    // Código de recuperação: vale uma vez só.
    const rc = recovery[0]
    assert.equal((await secondFactorLogin(second.challenge, rc, ip(), { now: t2, delay: false })).kind, 'ok')
    const third = await primaryLogin(u.email, u.password, ip(), { delay: false })
    if (third.kind !== 'mfa') return assert.fail('esperava desafio')
    assert.deepEqual(await secondFactorLogin(third.challenge, rc, ip(), { now: t2, delay: false }), { kind: 'invalid' })

    // Desafio adulterado ou vencido é recusado.
    assert.deepEqual(await secondFactorLogin(third.challenge + 'x', good, ip(), { now: t2, delay: false }), { kind: 'expired' })
    assert.deepEqual(await secondFactorLogin(third.challenge, good, ip(), { now: Date.now() + 6 * 60_000, delay: false }), { kind: 'expired' })

    // Novos códigos de recuperação exigem código válido e invalidam os antigos.
    const t3 = nextNow()
    await assert.rejects(regenerateRecovery(u.id, '000000', t3))
    const fresh = await regenerateRecovery(u.id, totpAt(setup.secret, t3), t3)
    assert.equal(fresh.length, 10)
    assert.equal(await db.recoveryCode.count({ where: { userId: u.id } }), 10)

    // Desativar exige senha + código; apaga segredo e códigos e sobe a versão de sessão.
    const t4 = nextNow()
    await assert.rejects(disableMfa(u.id, { password: 'errada', code: totpAt(setup.secret, t4) }, t4))
    await assert.rejects(disableMfa(u.id, { password: u.password, code: '000000' }, t4))
    const before = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).sessionVersion
    await disableMfa(u.id, { password: u.password, code: totpAt(setup.secret, t4) }, t4)
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.equal(after.totpSecret, null)
    assert.equal(after.totpEnabledAt, null)
    assert.equal(after.sessionVersion, before + 1)
    assert.equal(await db.recoveryCode.count({ where: { userId: u.id } }), 0)
    assert.equal((await primaryLogin(u.email, u.password, ip(), { delay: false })).kind, 'ok')
  })

  it('o segundo fator conta no mesmo limite do login (5 códigos errados bloqueiam)', async () => {
    const u = await makeUser()
    const setup = await beginSetup(u.id)
    const t = nextNow()
    await confirmSetup(u.id, totpAt(setup.secret, t), t)
    const addr = ip()
    const first = await primaryLogin(u.email, u.password, addr, { delay: false })
    if (first.kind !== 'mfa') return assert.fail('esperava desafio')
    for (let i = 0; i < 5; i++) assert.deepEqual(await secondFactorLogin(first.challenge, '000000', addr, { delay: false }), { kind: 'invalid' })
    assert.equal((await secondFactorLogin(first.challenge, '000000', addr, { delay: false })).kind, 'blocked')
    assert.equal((await primaryLogin(u.email, u.password, addr, { delay: false })).kind, 'blocked')
  })
})
