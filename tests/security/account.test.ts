// Onda 1: troca de e-mail (A1), tomada de conta por convite/Google (M1) e verificação de e-mail no servidor (M6).
// Rode DUAS vezes: `node test-env.mjs --mail -- npx tsx --test tests/security/account.test.ts` (e-mail simulado)
// e sem `--mail` (sem serviço de e-mail). Os casos se adaptam ao modo.
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import bcrypt from 'bcryptjs'
import { cleanup, captureMail, codeFrom, makeAccount, MAIL_ON, randomIp, uniq } from './helpers'
import { db } from '../../src/lib/db'
import { authorizeGoogleSignIn } from '../../src/lib/auth-google'
import { confirmEmailChange, EmailChangeError, emailChangeState, requestEmailChange } from '../../src/server/mail/email-change'
import { emailGateBlocks, issueEmailCode, needsEmailVerification } from '../../src/server/mail/email-verification'
import { SettingsError, updateSettings } from '../../src/server/settings/service'
import { acceptInvite, createInvite, resendInvite } from '../../src/server/team/service'

after(cleanup)

const rejectsWith = async (p: Promise<unknown>, code: string, status?: number) => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof EmailChangeError, `esperava EmailChangeError, veio ${String(e)}`)
    assert.equal(e.code, code)
    if (status) assert.equal(e.status, status)
    return true
  })
}

const settingsInput = (email: string) => ({ nome: 'Teste', email, empresa: 'Empresa', horarioAtendimento: 'Seg a sex', notifs: [] as never[] })

describe('A1: o e-mail NÃO troca pelo PUT de perfil, mesmo com a sessão aberta', () => {
  it('ATAQUE: updateSettings com e-mail diferente é recusado (400) e nada muda; o mesmo e-mail salva o resto', async () => {
    const u = await makeAccount({ verified: true })
    await assert.rejects(updateSettings(u.id, u.workspaceId, settingsInput(`atacante-${uniq()}@teste.local`)), (e: unknown) => e instanceof SettingsError && e.status === 400)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
    const ok = await updateSettings(u.id, u.workspaceId, { ...settingsInput(u.email), nome: 'Nome Novo' })
    assert.equal(ok.email, u.email)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).nome, 'Nome Novo')
  })
})

describe('A1: troca de e-mail com senha e confirmação no endereço novo', () => {
  if (!MAIL_ON) {
    it('SEM serviço de e-mail a troca fica indisponível (503) e o estado diz isso; nada muda', async () => {
      const u = await makeAccount({ verified: true })
      await rejectsWith(requestEmailChange(u.id, { novoEmail: `novo-${uniq()}@teste.local`, password: u.password }, randomIp()), 'unavailable', 503)
      const st = await emailChangeState(u.id)
      assert.equal(st.disponivel, false)
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
    })
    return
  }

  it('ATAQUE (sessão sem senha): senha errada não gera código nem troca nada', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      await rejectsWith(requestEmailChange(u.id, { novoEmail: `x-${uniq()}@teste.local`, password: 'senha-errada-qualquer' }, randomIp()), 'wrong_password', 400)
      assert.equal(mail.sent.length, 0, 'nenhum e-mail com senha errada')
      assert.equal(await db.verificationToken.count({ where: { identifier: { startsWith: `emailchange:${u.id}:` } } }), 0)
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
    } finally {
      mail.restore()
    }
  })

  it('conta só-Google (sem senha) não troca por aqui; e-mail em uso por outra conta é recusado; igual ao atual também', async () => {
    const google = await makeAccount({ password: null, verified: true })
    await rejectsWith(requestEmailChange(google.id, { novoEmail: `g-${uniq()}@teste.local`, password: 'qualquer-coisa' }, randomIp()), 'no_password', 409)
    assert.equal((await emailChangeState(google.id)).temSenha, false)

    const a = await makeAccount({ verified: true })
    const b = await makeAccount({ verified: true })
    await rejectsWith(requestEmailChange(a.id, { novoEmail: b.email.toUpperCase(), password: a.password }, randomIp()), 'email_taken', 409)
    await rejectsWith(requestEmailChange(a.id, { novoEmail: a.email, password: a.password }, randomIp()), 'same_email', 400)
  })

  it('conta com 2FA exige o código do aplicativo (sem ele, nada é enviado)', async () => {
    const u = await makeAccount({ verified: true })
    await db.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpSecret: null } })
    const mail = captureMail()
    try {
      await rejectsWith(requestEmailChange(u.id, { novoEmail: `d-${uniq()}@teste.local`, password: u.password }, randomIp()), 'wrong_2fa', 400)
      assert.equal(mail.sent.length, 0)
    } finally {
      mail.restore()
    }
    assert.equal((await emailChangeState(u.id)).doisFatores, true)
  })

  it('fluxo completo: código vai ao endereço NOVO, antigo é avisado, só vale após confirmar; sessões caem; uso único', async () => {
    const u = await makeAccount({ verified: true })
    const novo = `novo-${uniq()}@teste.local`
    // link de redefinição pendente do e-mail antigo: precisa morrer na troca
    await db.verificationToken.create({ data: { identifier: `pwreset:${u.email}`, token: `hash-${uniq()}`, expires: new Date(Date.now() + 600_000) } })
    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } })

    const mail = captureMail()
    try {
      const ip = randomIp()
      await requestEmailChange(u.id, { novoEmail: novo, password: u.password }, ip)
      assert.equal(mail.sent.length, 2, 'código ao novo + aviso ao antigo')
      const codeMail = mail.sent.find((m) => /^\d{6} /.test(m.assunto))
      const notice = mail.sent.find((m) => /Pedido para trocar/.test(m.assunto))
      assert.ok(codeMail && notice)
      const code = codeFrom(codeMail)

      // Ainda NÃO trocou; o pedido está pendente (com o e-mail mascarado) e só o hash do código está no banco.
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
      const st = await emailChangeState(u.id)
      assert.ok(st.pendente && !st.pendente.novoEmail.includes('novo-'), 'e-mail pendente mascarado')
      const row = await db.verificationToken.findFirstOrThrow({ where: { identifier: { startsWith: `emailchange:${u.id}:` } } })
      assert.ok(!row.token.includes(code) && /^[0-9a-f]{64}$/.test(row.token))

      // Código errado não troca; o certo troca.
      const wrong = code === '000000' ? '111111' : '000000'
      await rejectsWith(confirmEmailChange(u.id, wrong, ip), 'incorrect', 400)
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
      const done = await confirmEmailChange(u.id, code, ip)
      assert.equal(done.email, novo)

      const after = await db.user.findUniqueOrThrow({ where: { id: u.id } })
      assert.equal(after.email, novo)
      assert.ok(after.emailVerified, 'o endereço novo provou a posse')
      assert.equal(after.sessionVersion, before.sessionVersion + 1, 'sessões antigas invalidadas')
      assert.equal(await db.verificationToken.count({ where: { identifier: `pwreset:${u.email}` } }), 0, 'reset pendente do e-mail antigo apagado')
      assert.equal(await db.verificationToken.count({ where: { identifier: { startsWith: `emailchange` , contains: u.id } } }), 0)
      // E-mail antigo avisado da conclusão.
      assert.ok(mail.sent.some((m) => /foi trocado/.test(m.assunto)), 'aviso de conclusão ao e-mail antigo')
      // Auditoria.
      const acoes = (await db.auditLog.findMany({ where: { organizationId: u.organizationId, userId: u.id } })).map((a) => a.acao)
      assert.ok(acoes.includes('email.change_requested') && acoes.includes('email.changed'))

      // Uso único: repetir o mesmo código não troca de novo.
      await rejectsWith(confirmEmailChange(u.id, code, ip), 'expired', 400)
      // E a senha continua a mesma no e-mail novo.
      assert.ok(await bcrypt.compare(u.password, after.passwordHash ?? ''))
    } finally {
      mail.restore()
    }
  })

  it('ATAQUE: 5 códigos errados travam o pedido (o certo já não vale); pedir de novo respeita os 60 s', async () => {
    const u = await makeAccount({ verified: true })
    const novo = `lock-${uniq()}@teste.local`
    const mail = captureMail()
    try {
      const ip = randomIp()
      await requestEmailChange(u.id, { novoEmail: novo, password: u.password }, ip)
      const code = codeFrom(mail.sent[0])
      const wrong = code === '000000' ? '111111' : '000000'
      for (let i = 0; i < 4; i++) await rejectsWith(confirmEmailChange(u.id, wrong, ip), 'incorrect')
      await rejectsWith(confirmEmailChange(u.id, wrong, ip), 'locked', 429)
      await rejectsWith(confirmEmailChange(u.id, code, ip), 'expired', 400)
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
      // Segundo pedido logo em seguida: cooldown de 60 s.
      await rejectsWith(requestEmailChange(u.id, { novoEmail: novo, password: u.password }, ip), 'cooldown', 429)
    } finally {
      mail.restore()
    }
  })

  it('o código expira em 10 min', async () => {
    const u = await makeAccount({ verified: true })
    const mail = captureMail()
    try {
      const ip = randomIp()
      await requestEmailChange(u.id, { novoEmail: `exp-${uniq()}@teste.local`, password: u.password }, ip)
      const code = codeFrom(mail.sent[0])
      await db.verificationToken.updateMany({ where: { identifier: { startsWith: `emailchange:${u.id}:` } }, data: { expires: new Date(Date.now() - 1000) } })
      await rejectsWith(confirmEmailChange(u.id, code, ip), 'expired', 400)
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email, u.email)
    } finally {
      mail.restore()
    }
  })
})

describe('M1: convite não marca e-mail como verificado quando o link passou por quem convidou', () => {
  const owner = async () => {
    const o = await makeAccount({ verified: true })
    return { o, actor: { userId: o.id, organizationId: o.organizationId, papel: 'owner' as const } }
  }
  const tokenFromMail = (texto: string) => {
    const m = texto.match(/\/convite\/([A-Za-z0-9_-]{43})/)
    assert.ok(m, 'e-mail sem link do convite')
    return m[1]
  }
  const tokenFromLink = (link: string) => link.slice(link.lastIndexOf('/') + 1)

  if (MAIL_ON) {
    it('com e-mail: o link vai SÓ ao convidado (a API não o devolve a quem convidou) e o aceite prova a posse', async () => {
      const { actor } = await owner()
      const alvo = `conv-${uniq()}@teste.local`
      const mail = captureMail()
      try {
        const r = await createInvite(actor, { email: alvo, papel: 'admin', workspaceIds: [] })
        assert.equal(r.emailEnviado, true)
        assert.equal(r.link, null, 'link NÃO é exposto a quem convidou')
        assert.equal((await db.invite.findUniqueOrThrow({ where: { id: r.convite.id } })).emailEntregue, true)
        const token = tokenFromMail(mail.sent[0].texto)
        const acc = await acceptInvite(token, { nome: 'Convidada', senha: 'Senha-Forte-1234' }, randomIp())
        assert.equal(acc.ok, true)
        const u = await db.user.findUniqueOrThrow({ where: { email: alvo } })
        assert.ok(u.emailVerified, 'convite entregue ao e-mail = posse provada')
        await db.user.delete({ where: { id: u.id } })
      } finally {
        mail.restore()
      }
    })

    it('ATAQUE "copiar link": o reenvio sem e-mail devolve o link, e quem aceita nasce NÃO verificado e com código pendente', async () => {
      const { actor } = await owner()
      const alvo = `vitima-${uniq()}@teste.local`
      const mail = captureMail()
      try {
        const r = await createInvite(actor, { email: alvo, papel: 'admin', workspaceIds: [] })
        const copiado = await resendInvite(actor, r.convite.id, { enviarEmail: false })
        assert.ok(copiado.link, 'modo copiar link devolve o link')
        assert.equal((await db.invite.findUniqueOrThrow({ where: { id: r.convite.id } })).emailEntregue, false)
        const acc = await acceptInvite(tokenFromLink(copiado.link), { nome: 'Atacante', senha: 'Senha-Do-Atacante-1' }, randomIp())
        assert.equal(acc.ok, true)
        const u = await db.user.findUniqueOrThrow({ where: { email: alvo } })
        assert.equal(u.emailVerified, null, 'e-mail NÃO verificado')
        assert.equal(await needsEmailVerification(u.id), true, 'com e-mail configurado, a conta precisa confirmar por código')
        assert.ok(mail.sent.some((m) => /^\d{6} /.test(m.assunto) && m.para.endsWith('@teste.local')), 'código enviado ao e-mail do convidado')
        await db.user.delete({ where: { id: u.id } })
      } finally {
        mail.restore()
      }
    })
  } else {
    it('sem e-mail configurado: o link é mostrado a quem convida e a conta NASCE NÃO verificada (convite continua funcionando)', async () => {
      const { actor } = await owner()
      const alvo = `semmail-${uniq()}@teste.local`
      const r = await createInvite(actor, { email: alvo, papel: 'admin', workspaceIds: [] })
      assert.equal(r.emailEnviado, false)
      assert.ok(r.link)
      const acc = await acceptInvite(tokenFromLink(r.link), { nome: 'Convidada', senha: 'Senha-Forte-1234' }, randomIp())
      assert.equal(acc.ok, true)
      const u = await db.user.findUniqueOrThrow({ where: { email: alvo } })
      assert.equal(u.emailVerified, null)
      assert.equal(await needsEmailVerification(u.id), false, 'sem serviço de e-mail ninguém é obrigado a verificar')
      await db.user.delete({ where: { id: u.id } })
    })
  }

  it('ATAQUE completo: vítima que entra com o Google NÃO é vinculada à conta criada pelo convite "copiado"', async () => {
    const { actor } = await owner()
    const alvo = `vitima-${uniq()}@teste.local`
    // convite em modo "copiar link" (a API devolve o link a quem convidou)
    const r = await createInvite(actor, { email: alvo, papel: 'admin', workspaceIds: [] })
    const copiado = await resendInvite(actor, r.convite.id, { enviarEmail: false })
    assert.ok(copiado.link)
    const acc = await acceptInvite(copiado.link.slice(copiado.link.lastIndexOf('/') + 1), { nome: 'Atacante', senha: 'Senha-Do-Atacante-1' }, randomIp())
    assert.equal(acc.ok, true)
    const antes = await db.user.findUniqueOrThrow({ where: { email: alvo } })

    const decision = await authorizeGoogleSignIn({ provider: 'google', type: 'oidc', providerAccountId: `sub-${uniq()}` }, { email: alvo, email_verified: true })
    assert.equal(decision, 'needs-password')
    const depois = await db.user.findUniqueOrThrow({ where: { email: alvo } })
    assert.equal(depois.passwordHash, antes.passwordHash, 'nada foi alterado')
    assert.equal(await db.account.count({ where: { userId: antes.id } }), 0, 'sem vínculo')
    await db.user.delete({ where: { id: antes.id } })
  })
})

describe('M1: vínculo do login Google', () => {
  const profile = (email: string, verified = true) => ({ email, email_verified: verified })
  const acct = () => ({ provider: 'google', type: 'oidc', providerAccountId: `sub-${uniq()}` })

  it('e-mail do Google não verificado é recusado', async () => {
    const u = await makeAccount({ verified: true })
    assert.equal(await authorizeGoogleSignIn(acct(), profile(u.email, false)), 'deny')
  })

  it('conta com e-mail VERIFICADO: vincula sem tocar na senha', async () => {
    const u = await makeAccount({ verified: true })
    const a = acct()
    assert.equal(await authorizeGoogleSignIn(a, profile(u.email)), 'allow')
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.ok(row.passwordHash)
    assert.equal(await db.account.count({ where: { userId: u.id, providerAccountId: a.providerAccountId } }), 1)
    // já vinculado: entra de novo
    assert.equal(await authorizeGoogleSignIn(a, profile(u.email)), 'allow')
  })

  it('conta PRÓPRIA não verificada (dono único): o Google assume; senha, 2FA do impostor e sessões caem', async () => {
    const u = await makeAccount({ verified: false })
    await db.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpSecret: 'v1:segredo-do-impostor' } })
    await db.recoveryCode.create({ data: { userId: u.id, codeHash: `h-${uniq()}` } })
    await db.verificationToken.create({ data: { identifier: `pwreset:${u.email}`, token: `t-${uniq()}`, expires: new Date(Date.now() + 600_000) } })
    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } })

    assert.equal(await authorizeGoogleSignIn(acct(), profile(u.email)), 'allow')
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.equal(after.passwordHash, null)
    assert.ok(after.emailVerified)
    assert.equal(after.totpEnabledAt, null)
    assert.equal(after.totpSecret, null)
    assert.equal(after.sessionVersion, before.sessionVersion + 1)
    assert.equal(await db.recoveryCode.count({ where: { userId: u.id } }), 0)
    assert.equal(await db.verificationToken.count({ where: { identifier: `pwreset:${u.email}` } }), 0)
  })

  it('ATAQUE: conta não verificada que é MEMBRO de organização de outra pessoa NÃO é vinculada', async () => {
    const dono = await makeAccount({ verified: true })
    const membro = await makeAccount({ verified: false, papel: 'admin', orgId: dono.organizationId, workspaceId: dono.workspaceId })
    assert.equal(await authorizeGoogleSignIn(acct(), profile(membro.email)), 'needs-password')
    const row = await db.user.findUniqueOrThrow({ where: { id: membro.id } })
    assert.ok(row.passwordHash && row.emailVerified === null)
    assert.equal(await db.account.count({ where: { userId: membro.id } }), 0)
  })

  it('e-mail sem conta: segue o caminho normal (o adapter cria a conta)', async () => {
    assert.equal(await authorizeGoogleSignIn(acct(), profile(`novo-${uniq()}@teste.local`)), 'allow')
  })
})

describe('M6: e-mail verificado exigido NO SERVIDOR sem trancar contas antigas', () => {
  const mk = (verified: boolean, createdAt?: Date) => makeAccount({ verified }).then(async (u) => {
    if (createdAt) await db.user.update({ where: { id: u.id }, data: { createdAt } })
    return u
  })
  const since = process.env.EMAIL_VERIFICATION_SINCE

  after(() => {
    if (since === undefined) delete process.env.EMAIL_VERIFICATION_SINCE
    else process.env.EMAIL_VERIFICATION_SINCE = since
  })

  if (!MAIL_ON) {
    it('SEM serviço de e-mail ninguém é bloqueado (criar conta e usar o app seguem como hoje)', async () => {
      process.env.EMAIL_VERIFICATION_SINCE = new Date(Date.now() - 86_400_000).toISOString()
      const u = await mk(false)
      assert.equal(await needsEmailVerification(u.id), false)
      assert.equal(await emailGateBlocks(u.id), false)
    })
    return
  }

  it('conta nova não verificada (criada depois de EMAIL_VERIFICATION_SINCE) é bloqueada; verificada ou antiga não', async () => {
    process.env.EMAIL_VERIFICATION_SINCE = new Date(Date.now() - 3_600_000).toISOString()
    const nova = await mk(false)
    const verificada = await mk(true)
    const antiga = await mk(false, new Date(Date.now() - 30 * 86_400_000))
    assert.equal(await emailGateBlocks(nova.id), true)
    assert.equal(await emailGateBlocks(verificada.id), false)
    assert.equal(await emailGateBlocks(antiga.id), false, 'contas antigas (inclusive a do dono) nunca são trancadas')
  })

  it('sem EMAIL_VERIFICATION_SINCE só quem tem código pendente é bloqueado; "bloqueado" nunca fica em cache', async () => {
    delete process.env.EMAIL_VERIFICATION_SINCE
    const u = await mk(false)
    assert.equal(await emailGateBlocks(u.id), false)
    const mail = captureMail()
    try {
      await issueEmailCode({ id: u.id, email: u.email, nome: 'Teste' })
    } finally {
      mail.restore()
    }
    const v = await mk(false)
    const mail2 = captureMail()
    try {
      await issueEmailCode({ id: v.id, email: v.email, nome: 'Teste' })
    } finally {
      mail2.restore()
    }
    assert.equal(await emailGateBlocks(v.id), true)
    assert.equal(await emailGateBlocks(v.id), true, 'segue bloqueado')
    // ao verificar, libera na hora
    await db.user.update({ where: { id: v.id }, data: { emailVerified: new Date() } })
    assert.equal(await emailGateBlocks(v.id), false)
  })
})
