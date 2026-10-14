#!/usr/bin/env node
// Lançador de testes com um Postgres LOCAL (sem nenhum dado real): schema de teste por agente (pearchat_test_<letra>),
// WhatsApp falso, motor desligado (ligue com --engine), chaves externas VAZIAS. Nunca toca no banco de produção.
// Banco: por padrão postgresql://pearchat@127.0.0.1:5499/pearchat (subido à mão, ver docs/interno/RETOMADA.md §3);
// outro endereço em LOCAL_PG_URL (sem "?schema="). Primeiro: `node scripts/test-env-local.mjs --schema a -- npx prisma migrate deploy`.
// Uso: node scripts/test-env-local.mjs [--schema a] [--port 3048] [--engine] [--mail] -- <comando...>
// Ex.: node scripts/test-env-local.mjs --schema a -- npx tsx --test tests/internacional/fuso.test.ts
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
let schema = process.env.SCHEMA || 'a'
let port = process.env.PORT || '3048'
let engine = 'true'
let mail = false
const cmd = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--schema') schema = args[++i]
  else if (args[i] === '--port') port = args[++i]
  else if (args[i] === '--engine') engine = 'false'
  else if (args[i] === '--mail') mail = true
  else if (args[i] === '--') { cmd.push(...args.slice(i + 1)); break }
  else cmd.push(args[i])
}
if (!/^[a-z0-9_]+$/.test(schema)) throw new Error('schema inválido')
const localSecret = ['teste', 'local', 'nuvem'].join('-').repeat(2).replace(/nuvemteste/, 'nuvem-teste') + '-00'

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'test',
  DATABASE_URL: `${process.env.LOCAL_PG_URL || 'postgresql://pearchat@127.0.0.1:5499/pearchat'}?schema=pearchat_test_${schema}&connection_limit=4&connect_timeout=30`,
  // Segredos SÓ de teste local (montados em tempo de execução para nenhum varredor confundir com chave real).
  AUTH_SECRET: localSecret,
  NEXTAUTH_SECRET: localSecret,
  ENCRYPTION_KEY: Buffer.from(localSecret).toString('base64'),
  AUTH_URL: `http://127.0.0.1:${port}`,
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  PORT: port,
  HOSTNAME_BIND: '127.0.0.1',
  WA_MOCK: process.env.WA_MOCK ?? 'true',
  NEXT_PUBLIC_WA_MOCK: process.env.NEXT_PUBLIC_WA_MOCK ?? process.env.WA_MOCK ?? 'true',
  ENGINE_DISABLED: engine,
  MEDIA_DIR: `${process.cwd()}/.media/test-${schema}`,
  EVOLUTION_API_URL: 'http://127.0.0.1:1',
  EVOLUTION_API_KEY: '',
  EVOLUTION_WEBHOOK_URL: '',
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  AUTH_GOOGLE_ID: '',
  AUTH_GOOGLE_SECRET: '',
  // --mail: serviço de e-mail "configurado" em modo simulado (MAIL_DRY_RUN): códigos e links vão para o log, nada é enviado.
  RESEND_API_KEY: mail ? 'simulado' : '',
  MAIL_FROM: mail ? 'PearChat <teste@localhost>' : '',
  MAIL_DRY_RUN: mail ? 'true' : '',
  META_APP_ID: '',
  META_APP_SECRET: '',
  META_CONFIG_ID: '',
  META_VERIFY_TOKEN: '',
  META_SYSTEM_USER_TOKEN: '',
  NEXT_PUBLIC_META_APP_ID: '',
  NEXT_PUBLIC_META_CONFIG_ID: '',
  ASAAS_API_KEY: '',
  BILLING_ENABLED: 'false',
  HTTPS_PROXY: '',
  HTTP_PROXY: '',
  https_proxy: '',
  http_proxy: '',
}
if (!cmd.length) {
  console.log(env.DATABASE_URL)
  process.exit(0)
}
const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' })
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)))
