// Onda 2, etapa DISPOSITIVO: código por e-mail ao entrar de um dispositivo não reconhecido.
// Rode DUAS vezes (os casos se adaptam ao modo):
//   node scripts/test-env-local.mjs --schema a --mail -- npx tsx --test tests/security/dispositivo.test.ts   (e-mail simulado)
//   node scripts/test-env-local.mjs --schema a -- npx tsx --test tests/security/dispositivo.test.ts          (sem e-mail)
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { cleanup, captureMail, codeFrom, makeAccount, MAIL_ON, randomIp } from './helpers'
import { db } from '../../src/lib/db'
import { deviceTokenFor, deviceTokenFromCookieHeader, isTrustedDevice, issueDeviceToken, DEVICE_TTL_MS } from '../../src/server/security/device'
import { primaryLogin, secondFactorLogin, type PrimaryResult } from '../../src/server/security/login'
import { issueLoginCode, loginCodeSendState } from '../../src/server/security/login-code'
import { mfaState, readChallenge, revokeAllSessions } from '../../src/server/security/mfa'

after(cleanup)

const opts = { delay: false } as const
type Mfa = Extract<PrimaryResult, { kind: 'mfa' }>
const asMfa = (r: PrimaryResult): Mfa => {
  assert.equal(r.kind, 'mfa', `esperava desafio, veio ${r.kind}`)
  return r as Mfa
}
/** Libera o "Reenviar código" (simula a passagem de 61 s) mexendo só nas linhas de envio deste usuário. */
const skipCooldown = async (userId: string) => {
  const rows = await db.verificationToken.findMany({ where: { identifier: `logincode-sent:${userId}` } })
  for (const r of rows) {
    await db.verificationToken.update({
      where: { identifier_token: { identifier: r.identifier, token: r.token } },
      data: { expires: new Date(r.expires.getTime() - 61_000) },
    })
  }
}

describe('dispositivo confiável: token assinado (sem banco)', () => {
  it('vale só para o mesmo usuário, a mesma versão de sessão, dentro do prazo e sem adulteração', () => {
    const t = issueDeviceToken('user-a', 3)
    assert.equal(isTrustedDevice(t, { id: 'user-a', sessionVersion: 3 }), true)
    assert.equal(isTrustedDevice(t, { id: 'user-b', sessionVersion: 3 }), false, 'outro usuário')
    assert.equal(isTrustedDevice(t, { id: 'user-a', sessionVersion: 4 }), false, 'versão de sessão subiu')
    assert.equal(isTrustedDevice(t, { id: 'user-a', sessionVersion: 3 }, Date.now() + DEVICE_TTL_MS + 1000), false, 'expirado')
    const [body, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: 'user-b' })).toString('base64url')
    assert.equal(isTrustedDevice(`${forged}.${mac}`, { id: 'user-b', sessionVersion: 3 }), false, 'adulterado')
    assert.equal(isTrustedDevice(null, { id: 'user-a', sessionVersion: 3 }), false)
    assert.equal(deviceTokenFromCookieHeader(`a=1; pc_dev=${t}; b=2`), t)
    assert.equal(deviceTokenFromCookieHeader('a=1'), null)
  })
})

describe('sem serviço de e-mail configurado', { skip: MAIL_ON }, () => {
  it('login segue como hoje (ok direto, sem código) e Segurança informa "indisponível"', async () => {
    const u = await makeAccount({ verified: true })
    const r = await primaryLogin(u.email, u.password, randomIp(), opts)
    assert.equal(r.kind, 'ok')
    assert.equal((await mfaState(u.id)).newDeviceCode, false)
  })
})

describe('com serviço de e-mail configurado (simulado)', { skip: !MAIL_ON }, () => {
  it('dispositivo novo: senha certa NÃO entra; pede código por e-mail e envia um e-mail com código', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      assert.equal(r.method, 'email')
      assert.equal(r.emailMasked, `t***@teste.local`)
      const ch = readChallenge(r.challenge)
      assert.equal(ch?.t, 'email')
      assert.equal(ch?.u, u.id)
      assert.ok(ch && ch.e - Date.now() > 9 * 60_000, 'desafio por e-mail vale 10 min')
      assert.equal(mail.sent.length, 1)
      assert.equal(mail.sent[0].assunto, 'Seu código para entrar no PearChat')
      assert.match(mail.sent[0].texto, /troque-a agora/)
      assert.match(codeFrom(mail.sent[0]), /^\d{6}$/)
      assert.equal((await mfaState(u.id)).newDeviceCode, true)
    } finally {
      mail.restore()
    }
  })

  it('senha errada não envia nada; o authorize (sendCode: false) não envia e-mail', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      assert.equal((await primaryLogin(u.email, 'senha-errada', randomIp(), opts)).kind, 'invalid')
      const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), { ...opts, sendCode: false }))
      assert.equal(r.method, 'email')
      assert.equal(mail.sent.length, 0)
    } finally {
      mail.restore()
    }
  })

  it('código certo entra e grava o dispositivo; com ele o próximo login é direto; "sair de todos" esquece o dispositivo', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      const code = codeFrom(mail.sent[0])
      const ok = await secondFactorLogin(r.challenge, code, randomIp(), opts)
      assert.equal(ok.kind, 'ok')
      assert.equal(ok.kind === 'ok' && ok.method, 'email')
      // uso único: o mesmo desafio/código não entra de novo
      assert.notEqual((await secondFactorLogin(r.challenge, code, randomIp(), opts)).kind, 'ok')

      const device = await deviceTokenFor(u.id)
      assert.ok(device)
      const again = await primaryLogin(u.email, u.password, randomIp(), { ...opts, deviceToken: device })
      assert.equal(again.kind, 'ok', 'dispositivo confiável entra sem código')
      assert.equal(mail.sent.length, 1, 'nenhum e-mail novo')

      await revokeAllSessions(u.id)
      const later = asMfa(await primaryLogin(u.email, u.password, randomIp(), { ...opts, deviceToken: device }))
      assert.equal(later.method, 'email', 'depois de sair de todos os dispositivos o mesmo cookie não vale')

      // Cookie de OUTRA conta no mesmo navegador não vale para esta.
      const other = await makeAccount({ verified: true })
      const otherDevice = await deviceTokenFor(other.id)
      assert.equal(asMfa(await primaryLogin(u.email, u.password, randomIp(), { ...opts, deviceToken: otherDevice })).method, 'email')
    } finally {
      mail.restore()
    }
  })

  it('código errado 5× trava (nem o certo vale); "Reenviar" gera outro que funciona', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      const good = codeFrom(mail.sent[0])
      const wrong = good === '000000' ? '111111' : '000000'
      for (let i = 1; i <= 4; i++) assert.deepEqual(await secondFactorLogin(r.challenge, wrong, randomIp(), opts), { kind: 'invalid' })
      assert.deepEqual(await secondFactorLogin(r.challenge, wrong, randomIp(), opts), { kind: 'invalid', codeLocked: true })
      assert.deepEqual(await secondFactorLogin(r.challenge, good, randomIp(), opts), { kind: 'invalid', codeLocked: true })

      await skipCooldown(u.id)
      const again = await issueLoginCode({ id: u.id, email: u.email, nome: 'Teste' })
      assert.equal(again.ok, true)
      const fresh = codeFrom(mail.sent[1])
      assert.equal((await secondFactorLogin(r.challenge, fresh, randomIp(), opts)).kind, 'ok')
    } finally {
      mail.restore()
    }
  })

  it('código errado conta no limite do login (mesmo IP: 5 erros bloqueiam)', async () => {
    const u = await makeAccount({ verified: true })
    const ip = randomIp()
    const mail = captureMail()
    try {
      const r = asMfa(await primaryLogin(u.email, u.password, ip, opts))
      const wrong = codeFrom(mail.sent[0]) === '000000' ? '111111' : '000000'
      for (let i = 0; i < 5; i++) assert.equal((await secondFactorLogin(r.challenge, wrong, ip, opts)).kind, 'invalid')
      assert.equal((await secondFactorLogin(r.challenge, wrong, ip, opts)).kind, 'blocked')
      assert.equal((await primaryLogin(u.email, u.password, ip, opts)).kind, 'blocked')
    } finally {
      mail.restore()
    }
  })

  it('reenvio respeita 60 s (e um segundo login dentro do prazo não manda outro e-mail)', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      assert.equal(mail.sent.length, 1)
      const st = await loginCodeSendState(u.id)
      assert.ok(st.retryAfter > 50 && st.retryAfter <= 60, `espera ${st.retryAfter}s`)
      const r = await issueLoginCode({ id: u.id, email: u.email, nome: 'Teste' })
      assert.equal(r.ok, false)
      assert.equal(!r.ok && r.reason, 'cooldown')
      assert.equal(mail.sent.length, 1)
    } finally {
      mail.restore()
    }
  })

  it('desafio expirado não entra, mesmo com o código certo', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      const code = codeFrom(mail.sent[0])
      assert.deepEqual(await secondFactorLogin(r.challenge, code, randomIp(), { ...opts, now: Date.now() + 11 * 60_000 }), { kind: 'expired' })
      assert.deepEqual(await secondFactorLogin(r.challenge + 'x', code, randomIp(), opts), { kind: 'expired' })
    } finally {
      mail.restore()
    }
  })

  it('conta com 2FA continua pedindo o código do aplicativo (não o e-mail); desafio de e-mail não vale depois de ligar o 2FA', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      const pending = asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      const code = codeFrom(mail.sent[0])
      await db.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpSecret: null } })
      const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), opts))
      assert.equal(r.method, 'totp')
      assert.equal(readChallenge(r.challenge)?.t, 'totp')
      assert.equal(mail.sent.length, 1, 'nenhum e-mail para a conta com 2FA')
      assert.deepEqual(await secondFactorLogin(pending.challenge, code, randomIp(), opts), { kind: 'expired' })
    } finally {
      mail.restore()
    }
  })
})

// HTTP de ponta a ponta (opcional): servidor de teste com e-mail simulado no ar, por exemplo
//   node scripts/test-env-local.mjs --schema a --mail --port 3048 -- npx tsx server.ts
// e TEST_BASE_URL=http://127.0.0.1:3048 TEST_APP_ORIGIN=http://127.0.0.1:3048 ao rodar este arquivo. Sem a variável, pula.
const BASE = process.env.TEST_BASE_URL
describe('HTTP: rota do Auth.js e tela /verificar-acesso', { skip: !BASE || !MAIL_ON }, () => {
  const callback = async (u: { email: string; password: string }, extraCookie = '') => {
    const csrf = await fetch(`${BASE}/api/auth/csrf`)
    const jar = csrf.headers.getSetCookie().map((c) => c.split(';')[0]!)
    const { csrfToken } = (await csrf.json()) as { csrfToken: string }
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: [...jar, extraCookie].filter(Boolean).join('; '), 'x-forwarded-for': randomIp() },
      body: new URLSearchParams({ csrfToken, email: u.email, password: u.password, json: 'true' }).toString(),
    })
    const set = res.headers.getSetCookie().join('\n')
    return { location: res.headers.get('location') ?? '', session: /session-token=[^;]+/.test(set) }
  }

  it('sem o cookie de dispositivo a rota NÃO cria sessão (code=second_factor, como o deploy/validate.mjs vê); com ele, cria', async () => {
    const u = await makeAccount({ verified: true })
    const novo = await callback(u)
    assert.match(novo.location, /code=second_factor/)
    assert.equal(novo.session, false)
    const conhecido = await callback(u, `pc_dev=${await deviceTokenFor(u.id)}`)
    assert.equal(conhecido.session, true, 'dispositivo confiável entra direto')
  })

  it('a tela abre no modo e-mail (e-mail mascarado, Reenviar código, sem código de recuperação); sem desafio volta ao login', async () => {
    const u = await makeAccount({ verified: true })
    const r = asMfa(await primaryLogin(u.email, u.password, randomIp(), { ...opts, sendCode: false }))
    const page = await fetch(`${BASE}/verificar-acesso`, { headers: { cookie: `pc_mfa=${r.challenge}` }, redirect: 'manual' })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /t\*\*\*@teste\.local/)
    assert.match(html, /Reenviar código/)
    assert.doesNotMatch(html, /código de recuperação/)
    const sem = await fetch(`${BASE}/verificar-acesso`, { redirect: 'manual' })
    assert.ok([302, 303, 307, 308].includes(sem.status) || /\/login/.test(await sem.text()), 'sem desafio: volta ao login')
  })
})
