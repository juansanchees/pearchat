// Escopos do Google Agenda: autorização com os três escopos mínimos, callback com permissões completas / sem
// calendar.events / parciais, conta antiga (calendar.readonly) e revogação tolerante a falha.
// NUNCA chama o Google: o `fetch` é simulado. Não consulta o banco (importa o módulo, mas nenhuma função usada abre conexão). Rodar: npx tsx --test tests/google-calendar-scopes.test.ts
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, it, mock } from 'node:test'

import {
  GOOGLE_SCOPES,
  buildAuthUrl,
  checkGrantedScopes,
  encodeTokens,
  exchangeCodeChecked,
  readTokens,
  revokeToken,
} from '../src/server/calendar/google'

// Valores falsos de teste; as funções leem o ambiente só na hora de usar (não no import).
process.env.GOOGLE_CLIENT_ID = 'cliente-de-teste.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'segredo-de-teste'
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
process.env.AUTH_SECRET = 'segredo-de-teste-para-o-state'
process.env.NEXT_PUBLIC_APP_URL = 'https://pearchat.online'
delete process.env.GOOGLE_REDIRECT_URI

const EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const CALENDARLIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'
const READONLY = 'https://www.googleapis.com/auth/calendar.readonly'
const LOGIN = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'

// Tabela oficial de escopos por método (developers.google.com/workspace/calendar/api/v3/reference/<recurso>/<método>,
// conferida em 05/10/2026). Cada método chamado em src/server/calendar/google.ts precisa aceitar ao menos um escopo pedido.
const ESCOPOS_POR_METODO: Record<string, string[]> = {
  'calendarList.list': [
    READONLY,
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.calendarlist',
    CALENDARLIST,
  ],
  'freebusy.query': [
    READONLY,
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    FREEBUSY,
  ],
  'events.list': [
    READONLY,
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    EVENTS,
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.events.owned.readonly',
    'https://www.googleapis.com/auth/calendar.events.public.readonly',
  ],
  'events.insert': [
    'https://www.googleapis.com/auth/calendar',
    EVENTS,
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.owned',
  ],
  'events.patch': [
    'https://www.googleapis.com/auth/calendar',
    EVENTS,
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.owned',
  ],
  'events.delete': [
    'https://www.googleapis.com/auth/calendar',
    EVENTS,
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.owned',
  ],
}

type Chamada = { url: string; body: string }
const chamadas: Chamada[] = []

/** Troca o fetch global por um simulado. Nenhuma requisição sai da máquina. */
function simularFetch(resposta: (url: string, body: string) => Response | Promise<Response>) {
  chamadas.length = 0
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? init.body : ''
    chamadas.push({ url, body })
    return resposta(url, body)
  })
}

const tokenJson = (scope: string | undefined, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ access_token: 'at-teste', expires_in: 3600, refresh_token: 'rt-teste', ...(scope === undefined ? {} : { scope }), ...extra }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

afterEach(() => mock.restoreAll())

describe('URL de autorização', () => {
  it('pede exatamente os três escopos mínimos (e não o calendar.readonly)', () => {
    const url = new URL(buildAuthUrl('estado-de-teste', 'https://pearchat.online'))
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    const escopos = (url.searchParams.get('scope') ?? '').split(' ').sort()
    assert.deepEqual(escopos, [CALENDARLIST, EVENTS, FREEBUSY].sort())
    assert.ok(!escopos.includes(READONLY))
    assert.deepEqual([...GOOGLE_SCOPES].sort(), escopos)
  })

  it('mantém access_type=offline, prompt=consent e include_granted_scopes', () => {
    const p = new URL(buildAuthUrl('estado-de-teste', 'https://pearchat.online')).searchParams
    assert.equal(p.get('access_type'), 'offline')
    assert.equal(p.get('prompt'), 'consent')
    assert.equal(p.get('include_granted_scopes'), 'true')
    assert.equal(p.get('response_type'), 'code')
    assert.equal(p.get('redirect_uri'), 'https://pearchat.online/api/calendar/google/callback')
    assert.equal(p.get('state'), 'estado-de-teste')
  })

  it('cada método chamado pela integração é autorizado por pelo menos um dos escopos pedidos', () => {
    for (const [metodo, aceitos] of Object.entries(ESCOPOS_POR_METODO)) {
      assert.ok(
        GOOGLE_SCOPES.some((s) => aceitos.includes(s)),
        `${metodo} não é autorizado pelos escopos pedidos`,
      )
    }
  })

  it('o escopo antigo calendar.readonly não é necessário para nenhum método', () => {
    const semReadonly = GOOGLE_SCOPES.filter((s) => s !== READONLY)
    for (const [metodo, aceitos] of Object.entries(ESCOPOS_POR_METODO)) {
      assert.ok(semReadonly.some((s) => aceitos.includes(s)), `${metodo} dependeria do calendar.readonly`)
    }
  })
})

describe('callback: escopos concedidos', () => {
  const ir = async (scope: string | undefined) => {
    simularFetch(() => tokenJson(scope))
    return exchangeCodeChecked('codigo-de-teste', 'https://pearchat.online')
  }

  it('permissões completas: conecta e devolve os escopos para guardar', async () => {
    const r = await ir(`${EVENTS} ${CALENDARLIST} ${FREEBUSY}`)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual([...r.exchanged.scopes].sort(), [CALENDARLIST, EVENTS, FREEBUSY].sort())
      assert.equal(r.exchanged.refreshToken, 'rt-teste')
    }
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, 'https://oauth2.googleapis.com/token')
  })

  it('permissões completas junto com as do login (include_granted_scopes): conecta', async () => {
    const r = await ir(`${LOGIN} ${EVENTS} ${CALENDARLIST} ${FREEBUSY}`)
    assert.equal(r.ok, true)
  })

  it('sem calendar.events: não conecta e diz que faltam os eventos', async () => {
    const r = await ir(`${CALENDARLIST} ${FREEBUSY}`)
    assert.equal(r.ok, false)
    if (!r.ok) assert.deepEqual(r.faltando, ['eventos'])
  })

  it('só os escopos do login: não conecta e falta tudo', async () => {
    const r = await ir(LOGIN)
    assert.equal(r.ok, false)
    if (!r.ok) assert.deepEqual(r.faltando, ['eventos', 'agendas', 'horarios'])
  })

  it('parcial (sem a lista de agendas): não conecta', async () => {
    const r = await ir(`${EVENTS} ${FREEBUSY}`)
    assert.equal(r.ok, false)
    if (!r.ok) assert.deepEqual(r.faltando, ['agendas'])
  })

  it('parcial (sem horários livres/ocupados): não conecta', async () => {
    const r = await ir(`${EVENTS} ${CALENDARLIST}`)
    assert.equal(r.ok, false)
    if (!r.ok) assert.deepEqual(r.faltando, ['horarios'])
  })

  it('o Google omitiu o campo scope: valem os escopos pedidos', async () => {
    const r = await ir(undefined)
    assert.equal(r.ok, true)
  })

  it('conta antiga (calendar.events + calendar.readonly) segue funcionando sem reconectar', async () => {
    assert.deepEqual(checkGrantedScopes([EVENTS, READONLY]), { ok: true })
    const r = await ir(`${EVENTS} ${READONLY}`)
    assert.equal(r.ok, true)
  })

  it('conta antiga com só calendar.readonly (sem eventos) não conecta', async () => {
    assert.deepEqual(checkGrantedScopes([READONLY]), { ok: false, faltando: ['eventos'] })
  })

  it('o escopo geral calendar cobre as três permissões', () => {
    assert.deepEqual(checkGrantedScopes(['https://www.googleapis.com/auth/calendar']), { ok: true })
  })

  it('erro do Google na troca do code não vaza o corpo da resposta', async () => {
    simularFetch(() => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'detalhe-secreto' }), { status: 400 }))
    await assert.rejects(
      () => exchangeCodeChecked('codigo-ruim', 'https://pearchat.online'),
      (e: Error) => /invalid_grant/.test(e.message) && !/detalhe-secreto/.test(e.message),
    )
  })
})

describe('tokens guardados', () => {
  it('guarda e lê os escopos concedidos (criptografados junto dos tokens)', () => {
    const enc = encodeTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 123, scopes: [EVENTS, CALENDARLIST, FREEBUSY] })
    assert.ok(!enc.includes('"refreshToken"') && !enc.includes('calendar.events'), 'o conteúdo tem de ficar criptografado')
    assert.deepEqual(readTokens(enc)?.scopes, [EVENTS, CALENDARLIST, FREEBUSY])
  })

  it('conexão antiga (sem scopes guardados) continua legível', () => {
    const enc = encodeTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 })
    const lido = readTokens(enc)
    assert.equal(lido?.refreshToken, 'r')
    assert.equal(lido?.scopes, undefined)
  })
})

describe('revogação no Google (ao desconectar)', () => {
  it('envia o token ao endpoint de revogação e devolve true', async () => {
    simularFetch(() => new Response('{}', { status: 200 }))
    assert.equal(await revokeToken('rt-teste'), true)
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, 'https://oauth2.googleapis.com/revoke')
    assert.equal(new URLSearchParams(chamadas[0].body).get('token'), 'rt-teste')
  })

  it('o Google recusa (400): devolve false e não lança', async () => {
    simularFetch(() => new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 }))
    assert.equal(await revokeToken('rt-ja-revogado'), false)
  })

  it('erro de rede: devolve false e não lança', async () => {
    simularFetch(() => {
      throw new TypeError('fetch failed')
    })
    assert.equal(await revokeToken('rt-teste'), false)
  })

  it('o Google não responde: desiste pelo limite de tempo (o fetch recebe um AbortSignal)', async () => {
    let recebeuSinal = false
    mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      recebeuSinal = init?.signal instanceof AbortSignal
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    assert.equal(await revokeToken('rt-teste'), false)
    assert.equal(recebeuSinal, true)
  })
})
