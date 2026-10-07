// /api/health/check (monitor externo): regra do que é crítico (função pura) e comportamento da rota (token, 404, 503).
// Não precisa de banco: a rota é exercitada com um banco INALCANÇÁVEL (porta fechada), o que também prova o "banco_fora".
// Uso: npx tsx --test tests/health-check.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_THRESHOLDS, evaluateCritical, type Signals } from '../src/app/api/health/_lib/evaluate'

const ok = (over: Partial<Signals> = {}): Signals => ({
  dbOk: true,
  uptimeSeg: 3600,
  engineDisabled: false,
  engineActive: true,
  tickAgeSeg: 5,
  waCaidosComIa: 0,
  jobsAtrasados: 0,
  falhasEnvio: 0,
  enviosOk: 10,
  iaRecusadas: 0,
  inboxPendentes: 0,
  inboxMaisAntigoSeg: 0,
  backupIdadeH: 3,
  ...over,
})

describe('evaluateCritical: tudo certo não alarma', () => {
  it('estado saudável = lista vazia', () => assert.deepEqual(evaluateCritical(ok()), []))
  it('sinais desconhecidos (null) nunca viram alarme (tabela ausente, consulta que falhou, backup não instalado)', () => {
    const s = ok({ waCaidosComIa: null, jobsAtrasados: null, falhasEnvio: null, enviosOk: null, iaRecusadas: null, inboxPendentes: null, inboxMaisAntigoSeg: null, backupIdadeH: null })
    assert.deepEqual(evaluateCritical(s), [])
  })
})

describe('evaluateCritical: cada falha crítica aparece como categoria', () => {
  it('banco fora: só "banco_fora" (o resto não é confiável)', () => {
    assert.deepEqual(evaluateCritical(ok({ dbOk: false, waCaidosComIa: 3 })), ['banco_fora'])
  })
  it('WhatsApp desconectado com IA ligada', () => assert.deepEqual(evaluateCritical(ok({ waCaidosComIa: 2 })), ['whatsapp_desconectado=2']))
  it('fila parada a partir do limite de jobs atrasados', () => {
    assert.deepEqual(evaluateCritical(ok({ jobsAtrasados: DEFAULT_THRESHOLDS.jobsAtrasadosMin - 1 })), [])
    assert.deepEqual(evaluateCritical(ok({ jobsAtrasados: 7 })), ['fila_parada=7'])
  })
  it('falhas de envio em série: muitas falhas E nenhum envio bem-sucedido', () => {
    assert.deepEqual(evaluateCritical(ok({ falhasEnvio: 9, enviosOk: 0 })), ['falhas_de_envio=9'])
    assert.deepEqual(evaluateCritical(ok({ falhasEnvio: 9, enviosOk: 4 })), [], 'houve envio bom na janela: número inválido isolado, não alarma')
    assert.deepEqual(evaluateCritical(ok({ falhasEnvio: 2, enviosOk: 0 })), [], 'poucas falhas')
  })
  it('IA recusada por crédito/chave só a partir de algumas ocorrências', () => {
    assert.deepEqual(evaluateCritical(ok({ iaRecusadas: 1 })), [])
    assert.deepEqual(evaluateCritical(ok({ iaRecusadas: 4 })), ['ia_sem_credito=4'])
  })
  it('caixa de entrada de webhooks: muitos pendentes OU o mais antigo parado há muito tempo', () => {
    assert.deepEqual(evaluateCritical(ok({ inboxPendentes: 150, inboxMaisAntigoSeg: 5 })), ['entrada_acumulada=150'])
    assert.deepEqual(evaluateCritical(ok({ inboxPendentes: 2, inboxMaisAntigoSeg: 5000 })), ['entrada_acumulada=2'])
    assert.deepEqual(evaluateCritical(ok({ inboxPendentes: 2, inboxMaisAntigoSeg: 20 })), [])
    assert.deepEqual(evaluateCritical(ok({ inboxPendentes: 0, inboxMaisAntigoSeg: 99999 })), [], 'sem pendentes não há o que alarmar')
  })
  it('evento da caixa de entrada que desistiu nas últimas 24 h (mensagem não entrou)', () => {
    assert.deepEqual(evaluateCritical(ok({ inboxMortas24h: 2 })), ['entrada_morta=2'])
    assert.deepEqual(evaluateCritical(ok({ inboxMortas24h: 0 })), [])
    assert.deepEqual(evaluateCritical(ok({ inboxMortas24h: null })), [])
  })
  it('backup atrasado além do limite', () => {
    assert.deepEqual(evaluateCritical(ok({ backupIdadeH: 30 })), [])
    assert.deepEqual(evaluateCritical(ok({ backupIdadeH: 72 })), ['backup_atrasado'])
  })
  it('agendador parado: sem ciclo recente, inativo, ou nunca rodou (só depois do tempo de subida)', () => {
    assert.deepEqual(evaluateCritical(ok({ tickAgeSeg: 900 })), ['agendador_parado'])
    assert.deepEqual(evaluateCritical(ok({ engineActive: false })), ['agendador_parado'])
    assert.deepEqual(evaluateCritical(ok({ tickAgeSeg: null })), ['agendador_parado'])
    assert.deepEqual(evaluateCritical(ok({ tickAgeSeg: null, uptimeSeg: 30 })), [], 'acabou de subir: ainda não houve ciclo')
    assert.deepEqual(evaluateCritical(ok({ tickAgeSeg: 900, engineDisabled: true })), [], 'ENGINE_DISABLED de propósito não alarma')
  })
  it('várias falhas juntas aparecem todas, na ordem fixa', () => {
    const r = evaluateCritical(ok({ waCaidosComIa: 1, jobsAtrasados: 5, backupIdadeH: 100 }))
    assert.deepEqual(r, ['whatsapp_desconectado=1', 'fila_parada=5', 'backup_atrasado'])
  })
  it('o texto nunca contém nada além de categoria e número (sem dado pessoal)', () => {
    const r = evaluateCritical(ok({ waCaidosComIa: 1, jobsAtrasados: 5, falhasEnvio: 9, enviosOk: 0, iaRecusadas: 5, inboxPendentes: 300, backupIdadeH: 100, tickAgeSeg: 999 }))
    for (const p of r) assert.match(p, /^[a-z_]+(=\d+)?$/)
  })
})

describe('rota /api/health/check', () => {
  const TOKEN = 'token-de-teste-com-mais-de-dezesseis-caracteres'
  // Banco inalcançável de propósito (porta fechada): a rota tem de responder 503 "banco_fora", não travar nem vazar erro.
  process.env.DATABASE_URL = 'postgresql://x:y@127.0.0.1:3045/z?schema=pearchat_test_c&connect_timeout=2'
  process.env.HEALTH_TOKEN = TOKEN
  const call = async (path: string, init?: RequestInit) => {
    const { GET, HEAD } = await import('../src/app/api/health/check/route')
    const { resetCheckCache } = await import('../src/app/api/health/_lib/collect')
    resetCheckCache()
    const req = new Request(`http://localhost${path}`, init)
    return { get: await GET(req), head: await HEAD(new Request(`http://localhost${path}`, init)) }
  }

  it('sem token = 404 (a rota "não existe")', async () => {
    const { get } = await call('/api/health/check')
    assert.equal(get.status, 404)
    assert.equal(await get.text(), 'Not Found')
  })
  it('token errado = 404', async () => {
    const { get } = await call('/api/health/check?token=errado')
    assert.equal(get.status, 404)
  })
  it('token certo na query com banco fora = 503 "PROBLEMA: banco_fora"', async () => {
    const { get, head } = await call(`/api/health/check?token=${TOKEN}`)
    assert.equal(get.status, 503)
    assert.equal(await get.text(), 'PROBLEMA: banco_fora')
    assert.equal(head.status, 503)
    assert.equal(await head.text(), '')
  })
  it('token certo no cabeçalho também vale', async () => {
    const { get } = await call('/api/health/check', { headers: { 'x-health-token': TOKEN } })
    assert.equal(get.status, 503)
  })
  it('HEALTH_TOKEN curto demais = rota desligada (404 mesmo com o token certo)', async () => {
    const old = process.env.HEALTH_TOKEN
    process.env.HEALTH_TOKEN = 'curto'
    const { get } = await call('/api/health/check?token=curto')
    process.env.HEALTH_TOKEN = old
    assert.equal(get.status, 404)
  })
  it('sem HEALTH_TOKEN definido = 404', async () => {
    const old = process.env.HEALTH_TOKEN
    delete process.env.HEALTH_TOKEN
    const { get } = await call(`/api/health/check?token=${TOKEN}`)
    process.env.HEALTH_TOKEN = old
    assert.equal(get.status, 404)
  })
  it('resposta nunca é cacheada e não é indexável', async () => {
    const { get } = await call(`/api/health/check?token=${TOKEN}`)
    assert.equal(get.headers.get('cache-control'), 'no-store')
    assert.equal(get.headers.get('x-robots-tag'), 'noindex')
  })
})
