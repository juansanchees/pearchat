// Guarda de inicialização em produção.
//
// Com NODE_ENV=production o servidor RECUSA subir (mensagem clara no log, saída com código 78) se alguma variável de
// teste/simulação estiver ligada, se um segredo obrigatório faltar ou for fraco/de exemplo, ou se a DATABASE_URL apontar
// para um schema de teste. Objetivo: um .env de desenvolvimento copiado por engano para o servidor não pode derrubar o
// WhatsApp real nem abrir rotas de simulação em silêncio.
//
// Este arquivo NÃO importa nada do app (nem o banco): é carregado antes de tudo e também roda sozinho pelo CLI
// `scripts/check-env.ts`, que o deploy usa para validar o .env.production do servidor ANTES de trocar o app.
//
// Rodar localmente em modo produção (`tsx server.ts --prod` com WA_MOCK etc., como fazem os testes): defina
// BOOT_GUARD_ALLOW_LOCAL=1 E use AUTH_URL/NEXT_PUBLIC_APP_URL de localhost. Com URL pública, a variável é ignorada
// (e vira erro): não existe jeito de desligar o guarda num servidor de verdade.

export type Issue = { level: 'erro' | 'aviso'; code: string; msg: string }
export type Env = Record<string, string | undefined>

const TRUTHY = new Set(['true', '1', 'yes', 'on', 'sim'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** O deploy grava os valores entre aspas simples (`CHAVE='valor'`); o compose as remove, mas aqui toleramos as duas formas. */
function clean(v: string | undefined): string {
  let s = (v ?? '').trim()
  if (s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))) s = s.slice(1, -1).trim()
  return s
}
const isOn = (v: string | undefined): boolean => TRUTHY.has(clean(v).toLowerCase())

function isLocalHostname(h: string): boolean {
  const x = h.toLowerCase()
  return LOCAL_HOSTS.has(x) || x.endsWith('.localhost') || x.endsWith('.test')
}
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Qualidade de segredos
// ---------------------------------------------------------------------------------------------------------------------

const WEAK_WORDS = ['changeme', 'change-me', 'change_me', 'trocar', 'example', 'exemplo', 'placeholder', 'your-', 'your_', 'seu-', 'seu_', 'secret-here', 'password', 'senha123', 'minha-senha', 'insecure', 'default']

/** Texto de exemplo/fraco: curto, repetitivo, com poucos caracteres distintos ou com palavras típicas de modelo. */
export function weakSecretReason(value: string, minLen: number): string | null {
  const v = clean(value)
  if (!v) return 'vazio'
  if (v.length < minLen) return `curto demais (${v.length} caracteres; mínimo ${minLen})`
  const lower = v.toLowerCase()
  const word = WEAK_WORDS.find((w) => lower.includes(w))
  if (word) return `parece valor de exemplo ("${word}")`
  if (/^(.)\1+$/.test(v)) return 'um único caractere repetido'
  if (new Set(v).size < 10) return 'poucos caracteres distintos (valor de exemplo/previsível)'
  return null
}

/** ENCRYPTION_KEY: base64 de exatamente 32 bytes (a mesma regra de src/server/whatsapp/crypto.ts), com entropia mínima. */
function encryptionKeyIssue(raw: string): string | null {
  const v = clean(raw)
  if (!v) return 'não definida'
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return 'não é base64'
  const key = Buffer.from(v, 'base64')
  if (key.length !== 32) return `deve ser base64 de 32 bytes (veio ${key.length}); gere com: openssl rand -base64 32`
  if (new Set(key).size < 8) return 'bytes quase todos iguais (valor de exemplo)'
  const word = WEAK_WORDS.find((w) => v.toLowerCase().includes(w))
  if (word) return `parece valor de exemplo ("${word}")`
  return null
}

// ---------------------------------------------------------------------------------------------------------------------
// Verificações
// ---------------------------------------------------------------------------------------------------------------------

export function checkProductionEnv(env: Env): Issue[] {
  const out: Issue[] = []
  const err = (code: string, msg: string) => out.push({ level: 'erro', code, msg })
  const warn = (code: string, msg: string) => out.push({ level: 'aviso', code, msg })
  const get = (k: string) => clean(env[k])

  // --- Modo local (testes em modo produção na máquina do desenvolvedor) ---
  const urls = [get('AUTH_URL'), get('NEXT_PUBLIC_APP_URL')].filter(Boolean)
  const allLocal = urls.length > 0 && urls.every((u) => {
    const h = hostOf(u)
    return h !== null && isLocalHostname(h)
  })
  if (isOn(env.BOOT_GUARD_ALLOW_LOCAL)) {
    if (allLocal) {
      warn('GUARDA_LOCAL', 'BOOT_GUARD_ALLOW_LOCAL=1 com URL local: guarda de produção DESLIGADO (só vale em máquina de desenvolvimento).')
      return out
    }
    err('GUARDA_LOCAL_EM_SERVIDOR', 'BOOT_GUARD_ALLOW_LOCAL só é aceito com AUTH_URL e NEXT_PUBLIC_APP_URL de localhost. Remova a variável deste ambiente.')
  }

  // --- Simulações e atalhos de teste: nunca em produção ---
  const mustBeOff: [string, string][] = [
    ['WA_MOCK', 'troca o WhatsApp de TODOS os espaços por um provedor falso e liga as rotas de simulação'],
    ['NEXT_PUBLIC_WA_MOCK', 'embute o modo de demonstração do WhatsApp no site'],
    ['BILLING_MOCK', 'cobrança falsa em memória'],
    ['MAIL_DRY_RUN', 'e-mails deixam de ser enviados e os códigos/links vão para o log'],
    ['ENGINE_FOLLOWUP_ANYTIME', 'ignora a janela de silêncio do follow-up'],
  ]
  for (const [k, why] of mustBeOff) if (isOn(env[k])) err(k, `${k}=true não é permitido em produção (${why}).`)
  if (get('CONTACT_PHOTO_TEST_HOSTS')) err('CONTACT_PHOTO_TEST_HOSTS', 'CONTACT_PHOTO_TEST_HOSTS é só de teste (libera hosts locais para fotos de contato). Remova.')
  if (get('WA_MOCK_PHOTO_BASE')) err('WA_MOCK_PHOTO_BASE', 'WA_MOCK_PHOTO_BASE é só de teste. Remova.')

  // --- Graph API da Meta: só o domínio oficial ---
  const graph = get('META_GRAPH_BASE_URL')
  if (graph) {
    let ok = false
    try {
      const u = new URL(graph)
      ok = u.protocol === 'https:' && u.hostname === 'graph.facebook.com' && !u.port && !u.username && !u.password
    } catch {
      ok = false
    }
    if (!ok) err('META_GRAPH_BASE_URL', 'META_GRAPH_BASE_URL aponta para fora de https://graph.facebook.com: tokens da Meta iriam para outro servidor. Remova a variável.')
  }

  // --- Cobrança: sandbox não pode estar com a cobrança ligada ---
  if (isOn(env.BILLING_ENABLED)) {
    const base = get('ASAAS_BASE_URL')
    if (!base || /sandbox/i.test(base) || hostOf(base) !== 'api.asaas.com') {
      err('ASAAS_SANDBOX', 'BILLING_ENABLED=true, mas ASAAS_BASE_URL está vazio ou não é https://api.asaas.com (sandbox não cobra de verdade).')
    }
    if (!get('ASAAS_API_KEY')) err('ASAAS_API_KEY', 'BILLING_ENABLED=true exige ASAAS_API_KEY.')
    const wh = weakSecretReason(get('ASAAS_WEBHOOK_TOKEN'), 24)
    if (wh) err('ASAAS_WEBHOOK_TOKEN', `BILLING_ENABLED=true exige ASAAS_WEBHOOK_TOKEN forte: ${wh}.`)
  } else if (get('ASAAS_WEBHOOK_TOKEN')) {
    const wh = weakSecretReason(get('ASAAS_WEBHOOK_TOKEN'), 24)
    if (wh) warn('ASAAS_WEBHOOK_TOKEN', `ASAAS_WEBHOOK_TOKEN fraco (${wh}); troque antes de ligar a cobrança.`)
  }

  // --- Segredos obrigatórios ---
  const authSecret = get('AUTH_SECRET') || get('NEXTAUTH_SECRET')
  const a = weakSecretReason(authSecret, 32)
  if (a) err('AUTH_SECRET', `AUTH_SECRET inválido: ${a}. Gere com: openssl rand -base64 32`)

  const enc = encryptionKeyIssue(get('ENCRYPTION_KEY'))
  if (enc) err('ENCRYPTION_KEY', `ENCRYPTION_KEY inválida: ${enc}.`)

  const evo = weakSecretReason(get('EVOLUTION_API_KEY'), 24)
  if (evo) err('EVOLUTION_API_KEY', `EVOLUTION_API_KEY inválida: ${evo} (é a chave do webhook e da API da Evolution).`)

  // Webhook da Evolution: tem de ser o endereço INTERNO do compose (http://app:3000/...). Sem a variável o app usaria a URL
  // pública, e a borda (Caddy) bloqueia /api/wa/evolution: as mensagens recebidas se perderiam em silêncio.
  const hook = get('EVOLUTION_WEBHOOK_URL')
  const hookHost = hook ? hostOf(hook) : null
  if (!hook) err('EVOLUTION_WEBHOOK_URL', 'EVOLUTION_WEBHOOK_URL ausente: o webhook usaria a URL pública, que a borda bloqueia (use http://app:3000/api/wa/evolution).')
  else if (!hookHost || hookHost.includes('.')) err('EVOLUTION_WEBHOOK_URL', 'EVOLUTION_WEBHOOK_URL deve ser o endereço interno do compose (http://app:3000/api/wa/evolution); a borda bloqueia /api/wa/evolution pela internet.')
  // Segredo próprio do webhook (quando o app passar a usar): se definido, precisa ser forte.
  if (get('EVOLUTION_WEBHOOK_TOKEN')) {
    const w = weakSecretReason(get('EVOLUTION_WEBHOOK_TOKEN'), 24)
    if (w) err('EVOLUTION_WEBHOOK_TOKEN', `EVOLUTION_WEBHOOK_TOKEN inválido: ${w}.`)
  }

  // Opcionais: avisam se estiverem definidos de forma fraca.
  const health = get('HEALTH_TOKEN')
  if (!health) warn('HEALTH_TOKEN', 'HEALTH_TOKEN ausente: o monitor não enxerga fila, WhatsApp nem agendador em /api/health.')
  else {
    const w = weakSecretReason(health, 16)
    if (w) warn('HEALTH_TOKEN', `HEALTH_TOKEN fraco (${w}).`)
  }
  if (get('META_APP_ID') || get('NEXT_PUBLIC_META_APP_ID')) {
    for (const k of ['META_APP_SECRET', 'META_VERIFY_TOKEN']) {
      const w = weakSecretReason(get(k), 16)
      if (w) warn(k, `${k} da Meta: ${w}.`)
    }
  }

  // --- Banco ---
  const dbUrl = get('DATABASE_URL')
  if (!dbUrl) err('DATABASE_URL', 'DATABASE_URL ausente.')
  else {
    let u: URL | null = null
    try {
      u = new URL(dbUrl)
    } catch {
      u = null
    }
    if (!u || !/^postgres(ql)?:$/.test(u.protocol)) err('DATABASE_URL', 'DATABASE_URL inválida (esperado postgres:// ou postgresql://).')
    else {
      const schema = (u.searchParams.get('schema') ?? '').trim()
      if (/(^|[_-])(test|teste|tests|tmp|temp|restore|antes|dev|ci)([_-]|$)/i.test(schema) || /^pearchat_test/i.test(schema)) {
        err('DATABASE_SCHEMA_TESTE', `DATABASE_URL aponta para o schema "${schema}", que é de teste/restauração. Produção usa o schema "pearchat".`)
      } else if ((schema === '' || schema.toLowerCase() === 'public') && !isOn(env.BOOT_GUARD_ALLOW_PUBLIC_SCHEMA)) {
        err('DATABASE_SCHEMA_PUBLIC', 'DATABASE_URL sem ?schema=pearchat (ou com schema=public): o Prisma usaria o schema "public", que não é o do PearChat. Defina ?schema=pearchat.')
      }
      if (decodeURIComponent(u.username) === 'pearchat' && decodeURIComponent(u.password) === 'pearchat') err('DATABASE_URL', 'DATABASE_URL usa a senha de exemplo do banco de desenvolvimento.')
    }
  }

  // --- URL pública ---
  const authUrl = get('AUTH_URL')
  if (!authUrl) err('AUTH_URL', 'AUTH_URL ausente.')
  else if (!/^https:\/\//i.test(authUrl) || (hostOf(authUrl) !== null && isLocalHostname(hostOf(authUrl) as string))) {
    err('AUTH_URL', 'AUTH_URL precisa ser a URL pública em https (não localhost): os cookies de sessão seguros dependem disso.')
  }

  // --- Avisos de operação ---
  if (isOn(env.ENGINE_DISABLED)) {
    warn('ENGINE_DISABLED', 'ENGINE_DISABLED=true: o MOTOR DE AUTOMAÇÕES ESTÁ DESLIGADO (sem resposta da IA, disparos, follow-up nem lembretes). Só deve ser assim de propósito.')
  }
  // Desligamento gracioso: o servidor espera SHUTDOWN_GRACE_MS e tem uma trava final em +8 s; o Docker mata o processo em
  // stop_grace_period (40 s no compose). Acima de ~30 s a trava final já não cabe e o SIGKILL corta o desligamento no meio.
  const graceMs = Number(get('SHUTDOWN_GRACE_MS'))
  if (get('SHUTDOWN_GRACE_MS') && Number.isFinite(graceMs) && graceMs > 30_000) {
    warn('SHUTDOWN_GRACE_MS', `SHUTDOWN_GRACE_MS=${graceMs} é maior que 30000: com stop_grace_period de 40 s o Docker mata o app (SIGKILL) antes do fim do desligamento gracioso. Use 25000 (padrão) ou aumente APP_STOP_GRACE junto.`)
  }
  if (!get('RESEND_API_KEY') || !get('MAIL_FROM')) {
    warn('EMAIL', 'RESEND_API_KEY/MAIL_FROM ausentes: e-mails (verificação, redefinição de senha) não são enviados.')
  }
  return out
}

/** Texto para o log (uma linha por item, mais um cabeçalho). */
export function formatIssues(issues: Issue[]): string {
  const erros = issues.filter((i) => i.level === 'erro')
  const avisos = issues.filter((i) => i.level === 'aviso')
  const lines: string[] = []
  if (erros.length) {
    lines.push('================================================================================')
    lines.push(' PEARCHAT RECUSOU INICIAR EM PRODUCAO: configuração insegura ou incompleta')
    lines.push('================================================================================')
    for (const i of erros) lines.push(` [ERRO]  ${i.code}: ${i.msg}`)
  }
  for (const i of avisos) lines.push(` [AVISO] ${i.code}: ${i.msg}`)
  if (erros.length) lines.push(' Corrija o arquivo de ambiente do servidor e suba de novo. Nada foi iniciado.')
  return lines.join('\n')
}

type Sink = { error: (msg: string) => void; warn: (msg: string) => void }

/**
 * Chamado por server.ts logo depois de carregar o ambiente, só em produção. Em caso de erro imprime tudo e sai com 78
 * (EX_CONFIG): o Docker reinicia em laço, o healthcheck fica "unhealthy" e o deploy desfaz a troca.
 * `exit` e `sink` são injetáveis para o teste.
 */
export function assertProductionEnv(
  env: Env = process.env,
  opts: { exit?: (code: number) => never; sink?: Sink } = {},
): Issue[] {
  const sink = opts.sink ?? { error: (m: string) => console.error(m), warn: (m: string) => console.warn(m) }
  const exit = opts.exit ?? ((code: number) => process.exit(code))
  const issues = checkProductionEnv(env)
  const text = formatIssues(issues)
  if (issues.some((i) => i.level === 'erro')) {
    sink.error(text)
    return exit(78)
  }
  if (text) sink.warn(text)
  return issues
}
