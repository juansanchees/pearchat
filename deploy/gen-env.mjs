// Gera deploy/.env.production a partir do .env local. Não imprime valores.
// Segredos já existentes em deploy/.env.production são preservados. URL pública: PUBLIC_URL=https://pearchat.online node deploy/gen-env.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'deploy', '.env.production')
const port = process.env.PEARCHAT_PORT ?? '8088' // porta publicada só em 127.0.0.1 na VPS
const url = (process.env.PUBLIC_URL ?? 'https://pearchat.online').replace(/\/+$/, '') // URL pública (AUTH_URL / NEXT_PUBLIC_APP_URL)

const parse = (txt) => {
  const o = {}
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    o[m[1]] = v
  }
  return o
}
const src = parse(readFileSync(join(root, '.env'), 'utf8'))
const prev = existsSync(out) ? parse(readFileSync(out, 'utf8')) : {}
const keep = (k) => prev[k] || randomBytes(32).toString('base64url') // segredos novos só na 1ª geração

const env = {
  NODE_ENV: 'production',
  DATABASE_URL: src.DATABASE_URL,
  OPENAI_API_KEY: src.OPENAI_API_KEY ?? '',
  ANTHROPIC_API_KEY: src.ANTHROPIC_API_KEY ?? '',
  AI_MODEL: src.AI_MODEL ?? '',
  AI_TRANSCRIBE_MODEL: src.AI_TRANSCRIBE_MODEL || prev.AI_TRANSCRIBE_MODEL || '',
  AI_VISION: src.AI_VISION || prev.AI_VISION || '',
  ENCRYPTION_KEY: prev.ENCRYPTION_KEY || src.ENCRYPTION_KEY, // nunca trocar: quebraria dados já criptografados
  AUTH_URL: url,
  NEXT_PUBLIC_APP_URL: url,
  AUTH_TRUST_HOST: 'true',
  AUTH_SECRET: keep('AUTH_SECRET'),
  WA_MOCK: 'false',
  NEXT_PUBLIC_WA_MOCK: 'false',
  EVOLUTION_API_URL: 'http://evolution:8080',
  EVOLUTION_API_KEY: keep('EVOLUTION_API_KEY'),
  EVOLUTION_WEBHOOK_URL: 'http://app:3000/api/wa/evolution',
  EVOLUTION_DB_PASSWORD: keep('EVOLUTION_DB_PASSWORD'),
  PEARCHAT_PORT: port,
  META_APP_ID: prev.META_APP_ID ?? '', META_APP_SECRET: prev.META_APP_SECRET ?? '', META_CONFIG_ID: prev.META_CONFIG_ID ?? '',
  META_VERIFY_TOKEN: prev.META_VERIFY_TOKEN ?? '', META_SYSTEM_USER_TOKEN: prev.META_SYSTEM_USER_TOKEN ?? '',
  NEXT_PUBLIC_META_APP_ID: prev.NEXT_PUBLIC_META_APP_ID ?? '', NEXT_PUBLIC_META_CONFIG_ID: prev.NEXT_PUBLIC_META_CONFIG_ID ?? '',
  GOOGLE_CLIENT_ID: prev.GOOGLE_CLIENT_ID ?? '', GOOGLE_CLIENT_SECRET: prev.GOOGLE_CLIENT_SECRET ?? '', GOOGLE_REDIRECT_URI: prev.GOOGLE_REDIRECT_URI ?? '',
  CAMPAIGN_DAILY_LIMIT: src.CAMPAIGN_DAILY_LIMIT ?? '200',
  // E-mail transacional (Resend): copia do .env local quando existir; senão preserva o valor já gerado.
  RESEND_API_KEY: src.RESEND_API_KEY || prev.RESEND_API_KEY || '',
  MAIL_FROM: src.MAIL_FROM || prev.MAIL_FROM || '',
  EMAIL_VERIFICATION_SINCE: src.EMAIL_VERIFICATION_SINCE || prev.EMAIL_VERIFICATION_SINCE || '',
}
// Chaves que este script não conhece (ex.: HEALTH_TOKEN, MONITOR_WEBHOOK_URL, MONITOR_EMAIL_TO, BACKUP_*, MEDIA_DIR) e que já
// existem no arquivo gerado antes: preservadas como estão, em vez de descartadas a cada geração.
const preserved = Object.keys(prev).filter((k) => !(k in env))
for (const k of preserved) env[k] = prev[k]
for (const k of ['DATABASE_URL', 'ENCRYPTION_KEY']) if (!env[k]) throw new Error(`${k} ausente no .env local`)
// Valores entre aspas simples: compatível com env_file do compose e com --env-file (sem expansão de $).
writeFileSync(out, Object.entries(env).map(([k, v]) => `${k}='${String(v).replace(/'/g, '')}'`).join('\n') + '\n', { mode: 0o600 })
console.log(`gerado ${out} (${Object.keys(env).length} variáveis${preserved.length ? `; preservadas as não gerenciadas: ${preserved.join(', ')}` : ''})`)
