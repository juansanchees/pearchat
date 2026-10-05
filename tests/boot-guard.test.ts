// Guarda de inicialização em produção (src/server/boot/guard.ts). Não usa banco nem rede.
// Uso: npx tsx --test tests/boot-guard.test.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { assertProductionEnv, checkProductionEnv, formatIssues, weakSecretReason, type Env } from '../src/server/boot/guard'

const b64 = (n: number) => randomBytes(n).toString('base64')
const b64url = (n: number) => randomBytes(n).toString('base64url')

/** Ambiente de produção "bom": o que o deploy/gen-env.mjs gera, mais um HEALTH_TOKEN. */
function good(): Env {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres.abcdefgh:SenhaForte9xQ@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?schema=pearchat',
    ENCRYPTION_KEY: b64(32),
    AUTH_URL: 'https://pearchat.online',
    NEXT_PUBLIC_APP_URL: 'https://pearchat.online',
    AUTH_SECRET: b64url(32),
    WA_MOCK: 'false',
    NEXT_PUBLIC_WA_MOCK: 'false',
    EVOLUTION_API_KEY: b64url(32),
    HEALTH_TOKEN: b64url(32),
    RESEND_API_KEY: 're_xxxxxxxx',
    MAIL_FROM: 'PearChat <nao-responda@pearchat.online>',
    BILLING_ENABLED: 'false',
    ASAAS_BASE_URL: 'https://api-sandbox.asaas.com',
    ASAAS_WEBHOOK_TOKEN: b64url(32),
    META_APP_ID: '123',
    META_APP_SECRET: b64url(24),
    META_VERIFY_TOKEN: b64url(24),
    ENGINE_DISABLED: '',
    MAIL_DRY_RUN: '',
    META_GRAPH_BASE_URL: '',
    CONTACT_PHOTO_TEST_HOSTS: '',
  }
}
const errors = (env: Env) => checkProductionEnv(env).filter((i) => i.level === 'erro')
const codes = (env: Env) => errors(env).map((i) => i.code)
const noExit = (calls: number[]) =>
  ((c: number) => {
    calls.push(c)
    return undefined as never
  }) as (code: number) => never

describe('guarda de produção: configuração boa', () => {
  it('ambiente válido não gera erro', () => {
    assert.deepEqual(errors(good()), [])
  })
  it('valores entre aspas simples (formato do .env.production) também passam', () => {
    const env = good()
    for (const k of Object.keys(env)) env[k] = `'${env[k] ?? ''}'`
    assert.deepEqual(errors(env), [])
  })
  it('a configuração gerada pelo deploy/gen-env.mjs passa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-genenv-'))
    try {
      const src = join(dir, 'dev.env')
      const out = join(dir, 'prod.env')
      writeFileSync(
        src,
        [
          'DATABASE_URL="postgresql://postgres.abcdefgh:SenhaForte9xQ@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?schema=pearchat"',
          `ENCRYPTION_KEY="${b64(32)}"`,
          'OPENAI_API_KEY="sk-teste"',
          'WA_MOCK=true',
          'NEXT_PUBLIC_WA_MOCK=true',
          'MAIL_DRY_RUN=true',
        ].join('\n'),
      )
      execFileSync(process.execPath, ['deploy/gen-env.mjs'], {
        env: { ...process.env, GEN_ENV_SRC: src, GEN_ENV_OUT: out, PUBLIC_URL: 'https://pearchat.online' },
        stdio: 'pipe',
      })
      const env: Env = {}
      for (const line of readFileSync(out, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)='(.*)'$/)
        if (m) env[m[1]] = m[2]
      }
      assert.equal(env.WA_MOCK, 'false', 'o gerador força WA_MOCK=false mesmo com o .env de dev em true')
      assert.equal(env.MAIL_DRY_RUN, undefined)
      assert.deepEqual(errors(env), [], JSON.stringify(errors(env)))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('guarda de produção: cada condição recusa', () => {
  for (const k of ['WA_MOCK', 'NEXT_PUBLIC_WA_MOCK', 'BILLING_MOCK', 'MAIL_DRY_RUN', 'ENGINE_FOLLOWUP_ANYTIME']) {
    it(`${k}=true recusa`, () => {
      assert.ok(codes({ ...good(), [k]: 'true' }).includes(k))
      assert.ok(codes({ ...good(), [k]: "'true'" }).includes(k), 'com aspas')
      assert.ok(codes({ ...good(), [k]: '1' }).includes(k))
    })
    it(`${k}=false não recusa`, () => {
      assert.ok(!codes({ ...good(), [k]: 'false' }).includes(k))
    })
  }
  it('CONTACT_PHOTO_TEST_HOSTS e WA_MOCK_PHOTO_BASE definidos recusam', () => {
    assert.ok(codes({ ...good(), CONTACT_PHOTO_TEST_HOSTS: '127.0.0.1:3049' }).includes('CONTACT_PHOTO_TEST_HOSTS'))
    assert.ok(codes({ ...good(), WA_MOCK_PHOTO_BASE: 'http://127.0.0.1:3049' }).includes('WA_MOCK_PHOTO_BASE'))
  })
  it('META_GRAPH_BASE_URL fora da Meta recusa; a oficial passa', () => {
    assert.ok(codes({ ...good(), META_GRAPH_BASE_URL: 'http://127.0.0.1:3036' }).includes('META_GRAPH_BASE_URL'))
    assert.ok(codes({ ...good(), META_GRAPH_BASE_URL: 'https://graph.facebook.com.evil.example' }).includes('META_GRAPH_BASE_URL'))
    assert.ok(codes({ ...good(), META_GRAPH_BASE_URL: 'https://graph.facebook.com@evil.example' }).includes('META_GRAPH_BASE_URL'))
    assert.ok(codes({ ...good(), META_GRAPH_BASE_URL: 'http://graph.facebook.com' }).includes('META_GRAPH_BASE_URL'))
    assert.ok(!codes({ ...good(), META_GRAPH_BASE_URL: 'https://graph.facebook.com' }).includes('META_GRAPH_BASE_URL'))
    assert.ok(!codes({ ...good(), META_GRAPH_BASE_URL: 'https://graph.facebook.com/' }).includes('META_GRAPH_BASE_URL'))
  })
  it('cobrança ligada com Asaas sandbox (ou sem URL) recusa; com produção e chaves passa', () => {
    const on = { ...good(), BILLING_ENABLED: 'true', ASAAS_API_KEY: '$aact_chave_real_aaaaaaaaaaaaaaaaaaaa' }
    assert.ok(codes(on).includes('ASAAS_SANDBOX'))
    assert.ok(codes({ ...on, ASAAS_BASE_URL: '' }).includes('ASAAS_SANDBOX'))
    assert.ok(!codes({ ...on, ASAAS_BASE_URL: 'https://api.asaas.com' }).includes('ASAAS_SANDBOX'))
    assert.deepEqual(errors({ ...on, ASAAS_BASE_URL: 'https://api.asaas.com' }), [])
    assert.ok(codes({ ...on, ASAAS_BASE_URL: 'https://api.asaas.com', ASAAS_API_KEY: '' }).includes('ASAAS_API_KEY'))
    assert.ok(codes({ ...on, ASAAS_BASE_URL: 'https://api.asaas.com', ASAAS_WEBHOOK_TOKEN: 'curto' }).includes('ASAAS_WEBHOOK_TOKEN'))
  })
  it('cobrança desligada com Asaas sandbox é permitido (estado atual do servidor)', () => {
    assert.deepEqual(errors({ ...good(), BILLING_ENABLED: 'false', ASAAS_BASE_URL: 'https://api-sandbox.asaas.com' }), [])
  })
  it('AUTH_SECRET ausente, curto ou de exemplo recusa', () => {
    assert.ok(codes({ ...good(), AUTH_SECRET: '' }).includes('AUTH_SECRET'))
    assert.ok(codes({ ...good(), AUTH_SECRET: 'abc123' }).includes('AUTH_SECRET'))
    assert.ok(codes({ ...good(), AUTH_SECRET: 'changeme-changeme-changeme-changeme' }).includes('AUTH_SECRET'))
    assert.ok(codes({ ...good(), AUTH_SECRET: 'a'.repeat(40) }).includes('AUTH_SECRET'))
    assert.ok(codes({ ...good(), AUTH_SECRET: 'abababababababababababababababababab' }).includes('AUTH_SECRET'))
    assert.ok(!codes({ ...good(), AUTH_SECRET: undefined, NEXTAUTH_SECRET: b64url(32) }).includes('AUTH_SECRET'), 'NEXTAUTH_SECRET também vale')
  })
  it('ENCRYPTION_KEY ausente, de tamanho errado ou de exemplo recusa', () => {
    assert.ok(codes({ ...good(), ENCRYPTION_KEY: '' }).includes('ENCRYPTION_KEY'))
    assert.ok(codes({ ...good(), ENCRYPTION_KEY: b64(16) }).includes('ENCRYPTION_KEY'))
    assert.ok(codes({ ...good(), ENCRYPTION_KEY: b64(48) }).includes('ENCRYPTION_KEY'))
    assert.ok(codes({ ...good(), ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') }).includes('ENCRYPTION_KEY'), 'zeros')
    assert.ok(codes({ ...good(), ENCRYPTION_KEY: 'não é base64 !!!' }).includes('ENCRYPTION_KEY'))
  })
  it('EVOLUTION_API_KEY ausente ou fraca recusa', () => {
    assert.ok(codes({ ...good(), EVOLUTION_API_KEY: '' }).includes('EVOLUTION_API_KEY'))
    assert.ok(codes({ ...good(), EVOLUTION_API_KEY: 'curta' }).includes('EVOLUTION_API_KEY'))
    assert.ok(codes({ ...good(), EVOLUTION_API_KEY: 'change_me_change_me_change_me' }).includes('EVOLUTION_API_KEY'))
  })
  it('DATABASE_URL: ausente, schema de teste/restauração/public/sem schema ou senha de exemplo recusam', () => {
    const url = (q: string) => `postgresql://postgres.abcdefgh:SenhaForte9xQ@aws-0-sa-east-1.pooler.supabase.com:5432/postgres${q}`
    assert.ok(codes({ ...good(), DATABASE_URL: '' }).includes('DATABASE_URL'))
    assert.ok(codes({ ...good(), DATABASE_URL: 'mysql://x' }).includes('DATABASE_URL'))
    for (const s of ['pearchat_test_a', 'pearchat_test_e', 'pearchat_test_c', 'pearchat_restore_20261004', 'pearchat_antes_20261004_1200', 'teste', 'pearchat_dev']) {
      assert.ok(codes({ ...good(), DATABASE_URL: url(`?schema=${s}`) }).includes('DATABASE_SCHEMA_TESTE'), s)
    }
    assert.ok(codes({ ...good(), DATABASE_URL: url('?schema=public') }).includes('DATABASE_SCHEMA_PUBLIC'))
    assert.ok(codes({ ...good(), DATABASE_URL: url('') }).includes('DATABASE_SCHEMA_PUBLIC'))
    assert.ok(!codes({ ...good(), DATABASE_URL: url(''), BOOT_GUARD_ALLOW_PUBLIC_SCHEMA: '1' }).includes('DATABASE_SCHEMA_PUBLIC'))
    assert.equal(codes({ ...good(), DATABASE_URL: url('?schema=pearchat&connection_limit=5') }).length, 0)
    assert.ok(codes({ ...good(), DATABASE_URL: 'postgresql://pearchat:pearchat@localhost:5432/pearchat?schema=pearchat' }).includes('DATABASE_URL'))
  })
  it('AUTH_URL em http ou localhost recusa', () => {
    assert.ok(codes({ ...good(), AUTH_URL: 'http://pearchat.online' }).includes('AUTH_URL'))
    assert.ok(codes({ ...good(), AUTH_URL: 'https://localhost:3000' }).includes('AUTH_URL'))
    assert.ok(codes({ ...good(), AUTH_URL: '' }).includes('AUTH_URL'))
  })
})

describe('guarda de produção: avisos que NÃO recusam', () => {
  it('ENGINE_DISABLED=true avisa em destaque e não recusa', () => {
    const issues = checkProductionEnv({ ...good(), ENGINE_DISABLED: 'true' })
    assert.deepEqual(issues.filter((i) => i.level === 'erro'), [])
    const w = issues.find((i) => i.code === 'ENGINE_DISABLED')
    assert.ok(w && w.level === 'aviso' && /DESLIGADO/.test(w.msg))
  })
  it('HEALTH_TOKEN ausente e e-mail não configurado só avisam', () => {
    const env = good()
    delete env.HEALTH_TOKEN
    delete env.RESEND_API_KEY
    const issues = checkProductionEnv(env)
    assert.deepEqual(issues.filter((i) => i.level === 'erro'), [])
    assert.ok(issues.some((i) => i.code === 'HEALTH_TOKEN'))
    assert.ok(issues.some((i) => i.code === 'EMAIL'))
  })
  it('Meta com segredo vazio só avisa (servidor pode estar parcialmente configurado)', () => {
    const issues = checkProductionEnv({ ...good(), META_APP_SECRET: '', META_VERIFY_TOKEN: '' })
    assert.deepEqual(issues.filter((i) => i.level === 'erro'), [])
    assert.ok(issues.some((i) => i.code === 'META_APP_SECRET'))
  })
})

describe('guarda de produção: modo local (testes em --prod na máquina do dev)', () => {
  const local = { ...good(), AUTH_URL: 'http://localhost:3040', NEXT_PUBLIC_APP_URL: 'http://localhost:3040', WA_MOCK: 'true', MAIL_DRY_RUN: 'true' }
  it('sem BOOT_GUARD_ALLOW_LOCAL, mock com URL local ainda recusa', () => {
    assert.ok(codes(local).includes('WA_MOCK'))
  })
  it('com BOOT_GUARD_ALLOW_LOCAL=1 e URL local, o guarda só avisa', () => {
    const issues = checkProductionEnv({ ...local, BOOT_GUARD_ALLOW_LOCAL: '1' })
    assert.deepEqual(issues.filter((i) => i.level === 'erro'), [])
    assert.ok(issues.some((i) => i.code === 'GUARDA_LOCAL'))
  })
  it('BOOT_GUARD_ALLOW_LOCAL=1 com URL pública NÃO desliga nada e ainda vira erro', () => {
    const c = codes({ ...good(), WA_MOCK: 'true', BOOT_GUARD_ALLOW_LOCAL: '1' })
    assert.ok(c.includes('GUARDA_LOCAL_EM_SERVIDOR'))
    assert.ok(c.includes('WA_MOCK'))
  })
})

describe('assertProductionEnv', () => {
  it('chama exit(78) e imprime tudo quando há erro', () => {
    const logs: string[] = []
    const calls: number[] = []
    assertProductionEnv({ ...good(), WA_MOCK: 'true', AUTH_SECRET: 'x' }, { exit: noExit(calls), sink: { error: (m) => logs.push(m), warn: (m) => logs.push(m) } })
    assert.deepEqual(calls, [78])
    const all = logs.join('\n')
    assert.match(all, /RECUSOU INICIAR/)
    assert.match(all, /WA_MOCK/)
    assert.match(all, /AUTH_SECRET/)
  })
  it('não sai quando está tudo certo (só imprime avisos)', () => {
    const calls: number[] = []
    assertProductionEnv({ ...good(), ENGINE_DISABLED: 'true' }, { exit: noExit(calls), sink: { error: () => undefined, warn: () => undefined } })
    assert.deepEqual(calls, [])
  })
  it('a saída nunca contém o valor dos segredos', () => {
    const env = { ...good(), AUTH_SECRET: 'segredo-super-previsivel-aaaaaaaaaaaaaaa-changeme' }
    const text = formatIssues(checkProductionEnv(env))
    assert.ok(!text.includes('segredo-super-previsivel'))
  })
})

describe('weakSecretReason', () => {
  it('aceita aleatório, recusa previsível', () => {
    assert.equal(weakSecretReason(b64url(32), 32), null)
    assert.ok(weakSecretReason('', 8))
    assert.ok(weakSecretReason('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8))
    assert.ok(weakSecretReason('012345678012345678012345678012345678', 8), 'só 9 caracteres distintos')
  })
})
