// Prova que o `next build` passa SEM as variáveis de ambiente do servidor (a mesma situação do build dentro do Docker,
// onde só as NEXT_PUBLIC_* chegam). Existe porque, na etapa "Collecting page data", o Next importa o módulo de cada
// rota: qualquer código que rode na CARGA do módulo e dependa de AUTH_SECRET, do banco etc. derruba o build lá, e só lá
// (na máquina de desenvolvimento o .env mascara o problema). Exemplo real: `const X = hmac(...)` no topo de um arquivo.
//
//   npm run check:build-sem-env
//
// O que faz:
//  1. monta o ambiente do build: tudo do processo atual, MENOS as variáveis do app (as chaves de .env, .env.local,
//     .env.production, .env.example e uma lista fixa), que ficam definidas e VAZIAS: o Next não sobrescreve variável já
//     definida, mesmo vazia, então o .env local deixa de valer. Sobram só as públicas (NEXT_PUBLIC_*);
//  2. roda `prisma generate` e `next build` nesse ambiente (sem tocar em banco, Redis ou rede do app);
//  3. sai com código diferente de 0 se algum passo falhar.
//
// Em CI não existe .env: o script apenas roda o build com NEXT_PUBLIC_APP_URL definida e nenhuma outra variável do app.
// ATENÇÃO: o build grava em `.next/` (igual ao do Docker); não rode com o `npm run dev` ativo no mesmo diretório.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// Variáveis que o código lê e que podem não estar em nenhum arquivo .env (ou que o shell/CI pode exportar).
const KNOWN_KEYS = [
  'DATABASE_URL', 'DIRECT_URL', 'REDIS_URL', 'AUTH_SECRET', 'NEXTAUTH_SECRET', 'AUTH_URL', 'NEXTAUTH_URL', 'ENCRYPTION_KEY',
  'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN',
  'META_APP_ID', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_SYSTEM_USER_TOKEN', 'EVOLUTION_API_KEY', 'HEALTH_TOKEN',
]
// Prefixos de variáveis do app, para não herdar nada parecido do shell/CI.
const APP_PREFIX = /^(AUTH_|NEXTAUTH_|DATABASE_|REDIS_|META_|EVOLUTION_|OPENAI_|ANTHROPIC_|AI_|GOOGLE_|RESEND_|MAIL_|ASAAS_|BILLING_|PLAN_PRICE_|WA_|ENGINE_|ENCRYPTION_|HEALTH_|CAMPAIGN_|TRIAL_|SEED_|MEDIA_|LLM_|PHOTO_|EMAIL_|ACTIVE_SPACE_)/

/** Chaves (só os nomes, nunca os valores) de um arquivo no formato .env. */
function keysOf(file) {
  const full = path.join(root, file)
  if (!existsSync(full)) return []
  const keys = []
  for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (m) keys.push(m[1])
  }
  return keys
}

const blank = new Set(KNOWN_KEYS)
for (const f of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.example']) for (const k of keysOf(f)) blank.add(k)
for (const k of Object.keys(process.env)) if (APP_PREFIX.test(k)) blank.add(k)

const env = { ...process.env }
for (const k of blank) env[k] = ''
// Públicas (as únicas que o Docker passa no build) e o modo de produção, como no Dockerfile.
env.NEXT_PUBLIC_APP_URL = 'https://pearchat.online'
env.NEXT_PUBLIC_WA_MOCK = 'false'
env.NEXT_PUBLIC_META_APP_ID = ''
env.NEXT_PUBLIC_META_CONFIG_ID = ''
env.NEXT_TELEMETRY_DISABLED = '1'
env.NODE_ENV = 'production'

function step(title, script, args) {
  console.log(`\n[check-build-sem-env] ${title}`)
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit' })
  if (r.error) console.error(`[check-build-sem-env] não foi possível executar: ${r.error.message}`)
  return r.status === 0
}

console.log(`[check-build-sem-env] ${blank.size} variáveis do app zeradas; só NEXT_PUBLIC_* definidas (como no build do Docker).`)

if (!step('prisma generate', require.resolve('prisma/build/index.js'), ['generate'])) {
  console.error('\n[check-build-sem-env] FALHOU em `prisma generate`.')
  process.exit(1)
}
if (!step('next build', require.resolve('next/dist/bin/next'), ['build'])) {
  console.error(
    '\n[check-build-sem-env] FALHOU: o `next build` quebra SEM as variáveis do servidor (como no Docker).\n' +
      'Procure por código que roda na CARGA do módulo e depende de ambiente ou de banco (ex.: `const X = hmac(...)`,\n' +
      '`new URL(process.env.X)`, `throw` ligado a process.env, consulta ao `db` fora de função) e torne-o preguiçoso:\n' +
      'calcule na primeira utilização, dentro de uma função.',
  )
  process.exit(1)
}
console.log('\n[check-build-sem-env] OK: o build passou sem as variáveis do servidor.')
