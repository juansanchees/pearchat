// Heurística local de idioma da IA (sem rede, sem banco). Rodar: npx tsx --test tests/agent-language.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectLanguage, parseIdiomaConfig, resolveReplyLanguage } from '../src/server/agent/i18n'
import { buildSystemPrompt } from '../src/server/agent/prompt'
import { detectHandoffRule, genericHandoffMessage } from '../src/server/engine/rules'

const CASOS: [string, 'pt' | 'en' | 'es' | null][] = [
  ['¡Hola! Necesito ayuda con ZapRadar.', 'es'],
  ['Buenos días, ¿cuánto cuesta el servicio?', 'es'],
  ['Quiero hacer un pedido para mañana', 'es'],
  ['Hi, what are your opening hours?', 'en'],
  ['Hello! I need help with my order please', 'en'],
  ['Can you tell me the price?', 'en'],
  ['Oi, tudo bem? Quanto custa o corte?', 'pt'],
  ['Bom dia! Preciso remarcar meu horário', 'pt'],
  ['Não consegui pagar, vocês podem me ajudar?', 'pt'],
  ['Gostaria de agendar para amanhã', 'pt'],
  // ambíguos / sem texto: null (o chamador cai no histórico ou em português)
  ['ok', null],
  ['👍', null],
  ['12345', null],
  ['Pedido 123', null],
  ['Hola', 'es'],
  ['Thanks', 'en'],
  ['obrigado', 'pt'],
]

describe('detectLanguage', () => {
  for (const [texto, esperado] of CASOS) {
    it(`${JSON.stringify(texto)} -> ${esperado}`, () => assert.equal(detectLanguage(texto), esperado))
  }
})

describe('resolveReplyLanguage', () => {
  const u = (content: string) => ({ role: 'user', content })
  const a = (content: string) => ({ role: 'assistant', content })
  it('idioma fixo vale sempre', () => {
    assert.equal(resolveReplyLanguage('en', [u('Oi, tudo bem?')]), 'en')
    assert.equal(resolveReplyLanguage('es', [u('Hello')]), 'es')
  })
  it('auto: a última mensagem manda (troca de idioma)', () => {
    assert.equal(resolveReplyLanguage('auto', [u('Oi, quero agendar'), a('Claro!'), u('Actually, what are your opening hours?')]), 'en')
  })
  it('auto: mensagens seguidas desde a última resposta contam juntas', () => {
    assert.equal(resolveReplyLanguage('auto', [u('Hola'), u('necesito ayuda con mi pedido')]), 'es')
  })
  it('auto: emoji/ambígua mantém o idioma anterior do cliente', () => {
    assert.equal(resolveReplyLanguage('auto', [u('Hi, I need help with my order'), a('Sure!'), u('👍')]), 'en')
  })
  it('auto: sem nada decidível, português', () => {
    assert.equal(resolveReplyLanguage('auto', [u('👍')]), 'pt')
    assert.equal(resolveReplyLanguage('auto', []), 'pt')
  })
})

describe('parseIdiomaConfig', () => {
  it('só aceita os 4 valores', () => {
    assert.equal(parseIdiomaConfig('es'), 'es')
    assert.equal(parseIdiomaConfig('fr'), 'auto')
    assert.equal(parseIdiomaConfig(undefined), 'auto')
  })
})

describe('prompt do agente', () => {
  const base = { empresa: 'Studio X', agente: { nome: 'Luna', tom: 'Amigável' as const, prompt: '' }, kb: [], handoffRules: [] }
  it('auto: regra de acompanhar o idioma do cliente e nada que force português', () => {
    const p = buildSystemPrompt(base)
    assert.match(p, /Responda SEMPRE no mesmo idioma da ÚLTIMA mensagem do cliente/)
    assert.doesNotMatch(p, /sempre em português/i)
    assert.doesNotMatch(p, /em português do Brasil/i)
  })
  it('idioma fixo: regra explícita', () => {
    assert.match(buildSystemPrompt({ ...base, idioma: 'en' }), /Responda SEMPRE em inglês, mesmo que o cliente escreva em outro idioma\./)
    assert.match(buildSystemPrompt({ ...base, idioma: 'es' }), /Responda SEMPRE em espanhol/)
    assert.match(buildSystemPrompt({ ...base, idioma: 'pt' }), /Responda SEMPRE em português do Brasil/)
  })
})

describe('textos fixos', () => {
  it('passagem para humano segue o idioma', () => {
    assert.equal(genericHandoffMessage('Ana'), 'Claro, já estou passando sua conversa para Ana.')
    assert.equal(genericHandoffMessage('Ana', 'en'), "Of course, I'm passing your conversation to Ana now.")
    assert.equal(genericHandoffMessage('Ana', 'es'), 'Claro, ya estoy pasando tu conversación a Ana.')
    const hit = detectHandoffRule('quero desconto', ['Pedido de desconto'])
    assert.ok(hit)
    assert.match(hit.mensagem('Ana', 'es'), /condiciones especiales/)
    assert.match(hit.mensagem('Ana'), /condições especiais/)
  })
})
