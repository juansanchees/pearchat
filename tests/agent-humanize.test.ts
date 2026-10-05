// Acabamento da resposta da IA (sem rede, sem banco). Rodar: npx tsx --test tests/agent-humanize.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { finishReply, MOTIVO_MODELO, MOTIVO_PROMESSA } from '../src/server/agent/finish'
import { humanizeReply } from '../src/server/agent/humanize'
import { FIXED } from '../src/server/agent/i18n'
import { markUnknownMedia } from '../src/server/agent/llm'
import { typingDelayMs } from '../src/server/agent/pace'
import { buildSystemPrompt, HANDOFF_MARKER, HONESTIDADE_EXEMPLO, ownerSkipsBookingConfirmation } from '../src/server/agent/prompt'
import { promisesTeamAction } from '../src/server/agent/promises'

const h = humanizeReply

describe('humanizeReply: forma', () => {
  it('tira markdown e asteriscos', () => {
    assert.equal(h('**Olá!** Seu acesso fica em *Minha conta*.'), 'Olá! Seu acesso fica em Minha conta.')
    assert.equal(h('# Reembolso\nO prazo é de 7 dias.'), 'Reembolso O prazo é de 7 dias.')
  })
  it('lista vira frases corridas e quebras viram espaço', () => {
    assert.equal(h('Você pode:\n- olhar o spam\n- pedir o reenvio'), 'Você pode: Olhar o spam. Pedir o reenvio.')
    assert.equal(h('Passos:\n1. Abra o app\n2) Toque em Entrar'), 'Passos: Abra o app. Toque em Entrar.')
    assert.equal(h('Oi!\n\n\nTudo bem?'), 'Oi! Tudo bem?')
  })
  it('travessão vira vírgula, mas intervalo de horário fica', () => {
    assert.equal(h('Sim — até as 18h.'), 'Sim, até as 18h.')
    assert.equal(h('Refunds are covered for 7 days—tell me the email.'), 'Refunds are covered for 7 days, tell me the email.')
    assert.equal(h('Atendemos das 9 – 18h.'), 'Atendemos das 9 – 18h.')
    assert.equal(h('Atendemos das 9—18h.'), 'Atendemos das 9—18h.')
  })
  it('"equipe" do português escapando no espanhol vira "equipo"', () => {
    assert.equal(h('Gracias. Voy a pasar tu caso a la equipo para que reenvíen el acceso manualmente.'), 'Gracias. Voy a pasar tu caso al equipo para que reenvíen el acceso manualmente.')
    assert.equal(h('Claro. Para que la equipe te reenvíe el acceso, ¿me pasas el email?'), 'Claro. Para que el equipo te reenvíe el acceso, ¿me pasas el email?')
    assert.equal(h('A equipe vai te ajudar com isso.'), 'A equipe vai te ajudar com isso.')
  })
  it('emoji: no máximo um no Amigável; nenhum no Profissional e no Direto; © fica', () => {
    assert.equal(h('Oi! 😊 Tudo certo 👍🏽', { tom: 'Amigável' }), 'Oi! 😊 Tudo certo')
    assert.equal(h('Bom dia. 😊', { tom: 'Profissional' }), 'Bom dia.')
    assert.equal(h('Aceitamos sim 👍', { tom: 'Direto' }), 'Aceitamos sim')
    assert.equal(h('ZapRadar© 2026', { tom: 'Direto' }), 'ZapRadar© 2026')
  })
})

describe('humanizeReply: frases de roteiro e reapresentação', () => {
  it('corta fórmula inteira nos três idiomas quando sobra conteúdo', () => {
    assert.equal(h('Entendo sua solicitação. O estorno sai em até 5 dias úteis. Fico à disposição!'), 'O estorno sai em até 5 dias úteis.')
    assert.equal(h('¡Entiendo! El enlace es https://exemplo.com/acesso. ¿En qué más puedo ayudarte?'), 'El enlace es https://exemplo.com/acesso.')
    assert.equal(h('I understand your concern. Your refund takes up to 7 days. Is there anything else I can help you with?'), 'Your refund takes up to 7 days.')
  })
  it('não deixa a resposta só com saudação nem vazia', () => {
    assert.equal(h('Oi! Como posso ajudar?'), 'Oi! Como posso ajudar?')
    assert.equal(h('Entendido.'), 'Entendido.')
  })
  it('tom Direto: "oi" sozinho recebe só cumprimento curto, sem oferta de ajuda', () => {
    assert.equal(h('Hola, ¿en qué te ayudo con ZapRadar?', { tom: 'Direto', clienteTexto: 'Hola' }), 'Hola, dime.')
    assert.equal(h('Oi! Como posso te ajudar?', { tom: 'Direto', clienteTexto: 'oi' }), 'Oi, pode falar.')
    assert.equal(h('Oi! Como posso te ajudar?', { tom: 'Amigável', clienteTexto: 'oi' }), 'Oi! Como posso te ajudar?')
    assert.equal(h('Oi! O link é https://exemplo.com/a', { tom: 'Direto', clienteTexto: 'oi' }), 'Oi! O link é https://exemplo.com/a')
  })
  it('interjeição solta de abertura sai no Direto e no Profissional, fica no Amigável', () => {
    assert.equal(h('Perfeito! O link é https://exemplo.com/a', { tom: 'Direto' }), 'O link é https://exemplo.com/a')
    assert.equal(h('Claro! Pode sim.', { tom: 'Profissional' }), 'Pode sim.')
    assert.equal(h('Claro! Pode sim.', { tom: 'Amigável' }), 'Claro! Pode sim.')
  })
  it('reapresentação depois da primeira resposta sai (com emoji colado), a não ser que perguntem quem é', () => {
    const r = h('Olá! Eu sou o Luiz do Suporte ZapRadar 😊 Me diga o que aconteceu.', { jaRespondeu: true, agentName: 'Luiz', clienteTexto: 'não consigo entrar' })
    assert.equal(r, 'Me diga o que aconteceu.')
    const q = h('Sou o Luiz, assistente virtual do suporte. Se preferir, chamo alguém da equipe.', { jaRespondeu: true, agentName: 'Luiz', clienteTexto: 'vc é um robô?' })
    assert.match(q, /assistente virtual/)
  })
  it('reapresentação com fato (link, número, e-mail) nunca é cortada', () => {
    const t = 'Sou o Luiz e o link é https://exemplo.com/acesso'
    assert.equal(h(t, { jaRespondeu: true, agentName: 'Luiz' }), t)
  })
  it('saudação repetida no meio da conversa sai, a menos que o cliente tenha cumprimentado agora', () => {
    assert.equal(h('¡Hola! El plazo es de 7 días.', { jaRespondeu: true, clienteTexto: 'y el reembolso?' }), 'El plazo es de 7 días.')
    assert.equal(h('¡Hola! El plazo es de 7 días.', { jaRespondeu: true, clienteTexto: 'hola, y el reembolso?' }), '¡Hola! El plazo es de 7 días.')
  })
  it('nunca altera valores, horários, links nem e-mails', () => {
    const casos = [
      'Entendo. O valor é R$ 1.250,50 e vence 10/10 às 14:30. Fico à disposição.',
      '**Pix:** contato@exemplo.com — ou acesse https://exemplo.com/pagar?id=12_3',
      '- Corte: 30 min\n- Barba: 20 min',
    ]
    for (const c of casos) {
      const out = h(c, { tom: 'Direto', jaRespondeu: true, agentName: 'Luna' })
      for (const fato of c.match(/R\$ ?[\d.,]+|\d{1,2}[:/]\d{2}|https?:\/\/\S+|\S+@\S+|\d+ min/g) ?? []) assert.ok(out.includes(fato), `${fato} sumiu de: ${out}`)
    }
  })
})

describe('promisesTeamAction (promessa da equipe sem passagem)', () => {
  const sim = [
    'Gracias, ya tengo tu email. En breve el equipo de ZapRadar te enviará el acceso manualmente.',
    'Con eso lo derivo al equipo de análisis.',
    'El acceso lo enviaremos manualmente al email que usaste en la compra.',
    'Vou encaminhar para a equipe.',
    'A equipe vai analisar e te retorna.',
    'Nossa equipe de suporte irá verificar o pagamento.',
    'Já te retorno com a confirmação.',
    'Our team will look into it.',
    "I'll forward this to billing.",
    'Someone will contact you shortly.',
    'Ya estoy pasando tu caso al equipo.',
    "I'm passing this to the team now.",
    FIXED.pt.valorSeguro,
    FIXED.en.valorSeguro,
    FIXED.es.valorSeguro,
  ]
  const nao = [
    'O atendimento vai das 9h às 18h.',
    'Te envio o link: https://exemplo.com/acesso',
    'Se preferir, a equipe confirma com você.',
    'O estorno é feito em até 5 dias úteis.',
    'Quem confirma os horários é a equipe.',
    'Marcado: amanhã às 16h.',
    'Our support hours are 9 to 5.',
    'Você pode acessar por este link: https://exemplo.com/acesso',
    'No puedo escuchar audios por aquí, ¿me lo escribes?',
  ]
  for (const t of sim) it(`promete: ${t}`, () => assert.equal(promisesTeamAction(t), true))
  for (const t of nao) it(`não promete: ${t}`, () => assert.equal(promisesTeamAction(t), false))
})

describe('finishReply (estilo + passagem)', () => {
  const ctx = { history: [{ role: 'user' as const, content: 'mi email es cliente@example.com' }], tom: 'Amigável' as const, agentName: 'Luiz' }
  it('marcador com frase: passa e manda a frase do modelo (sem o marcador)', () => {
    const r = finishReply(`Le paso tu caso al equipo para reenviar el acceso; te escriben por aquí. ${HANDOFF_MARKER}`, ctx)
    assert.equal(r.kind, 'handoff')
    if (r.kind !== 'handoff') return
    assert.equal(r.motivo, MOTIVO_MODELO)
    assert.equal(r.message, 'Le paso tu caso al equipo para reenviar el acceso; te escriben por aquí.')
  })
  it('só o marcador: passa com o texto fixo (message null)', () => {
    const r = finishReply(HANDOFF_MARKER, ctx)
    assert.deepEqual(r.kind === 'handoff' && r.message, null)
  })
  it('promessa sem marcador: vira passagem (motivo próprio)', () => {
    const r = finishReply('Gracias. En breve el equipo te enviará el acceso manualmente.', ctx)
    assert.equal(r.kind, 'handoff')
    assert.equal(r.kind === 'handoff' && r.motivo, MOTIVO_PROMESSA)
  })
  it('sem promessa: resposta normal, só com acabamento', () => {
    assert.deepEqual(finishReply('**Listo.** El enlace es https://exemplo.com/acesso', ctx), { kind: 'reply', texto: 'Listo. El enlace es https://exemplo.com/acesso' })
  })
  it('marcador fora de hora (ainda pedindo um dado, ou só oferecendo uma pessoa) não passa', () => {
    for (const t of [
      'Sí, te ayudo con eso. ¿Me pasas el email con el que compraste?',
      "I'm sorry this happened. I can request a refund for you, but I'll need the email you used to buy.",
      'Sim, é um assistente virtual. Se você quiser, eu passo sua conversa para a equipe.',
      'Sou o assistente virtual do Suporte ZapRadar; se preferir, chamo alguém da equipe.',
    ]) {
      const r = finishReply(`${t} ${HANDOFF_MARKER}`, ctx)
      assert.equal(r.kind, 'reply', t)
      assert.ok(r.kind === 'reply' && !r.texto.includes(HANDOFF_MARKER))
    }
  })
  it('marcador com promessa da equipe continua passando, mesmo com pergunta no fim', () => {
    const r = finishReply(`Le paso tu caso al equipo para reenviarte el acceso. ¿Algo más? ${HANDOFF_MARKER}`, ctx)
    assert.equal(r.kind, 'handoff')
    assert.equal(finishReply(`I'm passing this to the team; they'll reply here. ${HANDOFF_MARKER}`, ctx).kind, 'handoff')
  })
  it('frase de passagem com valor em dinheiro não sai (usa o texto fixo)', () => {
    const r = finishReply(`O estorno de R$ 99,90 vai ser feito pela equipe. ${HANDOFF_MARKER}`, ctx)
    assert.equal(r.kind === 'handoff' && r.message, null)
  })
})

describe('mídia sem conteúdo (áudio sem transcrição etc.)', () => {
  it('marca áudio/imagem/documento do cliente como conteúdo desconhecido', () => {
    const [a, b, c] = markUnknownMedia([
      { role: 'user', content: 'hola\n[Áudio]' },
      { role: 'assistant', content: '[Áudio]' },
      { role: 'user', content: '[Imagem] olha o erro' },
    ])
    assert.match(a?.content ?? '', /^hola\n\[Áudio sem transcrição: conteúdo desconhecido/)
    assert.equal(b?.content, '[Áudio]')
    assert.match(c?.content ?? '', /conteúdo desconhecido.*escreveu junto:\] olha o erro$/)
  })
  it('não mexe em transcrição nem na imagem anexada (visão)', () => {
    const msgs = markUnknownMedia([
      { role: 'user', content: '[Áudio transcrito] quero meu acesso' },
      { role: 'user', content: '[Imagem]', image: { mime: 'image/png', base64: 'AA==' } },
    ])
    assert.equal(msgs[0]?.content, '[Áudio transcrito] quero meu acesso')
    assert.equal(msgs[1]?.content, '[Imagem]')
  })
})

describe('prompt', () => {
  const base = { empresa: 'Studio X', agente: { nome: 'Luna', tom: 'Amigável' as const, prompt: '' }, kb: [], handoffRules: [] }
  it('honestidade: nunca se passar por pessoa e dizer a verdade quando perguntarem', () => {
    const p = buildSystemPrompt(base)
    assert.ok(p.includes(HONESTIDADE_EXEMPLO))
    assert.match(p, /NUNCA diga nem dê a entender que é uma pessoa/)
    assert.match(p, /Não invente experiências pessoais/)
  })
  it('idioma preservado: segue o cliente e não força português', () => {
    const p = buildSystemPrompt(base)
    assert.match(p, /Responda SEMPRE no mesmo idioma da ÚLTIMA mensagem do cliente/)
    assert.match(p, /nunca misture idiomas/)
    assert.doesNotMatch(p, /sempre em português/i)
  })
  it('os três tons têm blocos próprios e diferentes', () => {
    const t = (tom: 'Amigável' | 'Profissional' | 'Direto') => buildSystemPrompt({ ...base, agente: { ...base.agente, tom } })
    assert.match(t('Direto'), /TOM DE VOZ: DIRETO[\s\S]*UMA frase curta/)
    assert.match(t('Profissional'), /TOM DE VOZ: PROFISSIONAL[\s\S]*sem emoji/)
    assert.match(t('Amigável'), /TOM DE VOZ: AMIGÁVEL[\s\S]*tamanho muda/)
    assert.doesNotMatch(t('Direto'), /TOM DE VOZ: AMIGÁVEL/)
  })
  it('regras antigas que não podem sumir', () => {
    const p = buildSystemPrompt({ ...base, servicos: [{ nome: 'Corte', duracaoMin: 30 }] })
    for (const s of ['Responda apenas sobre Studio X', 'REGRAS DE FORMATO E CONDUTA', 'Você NÃO consegue agendar', 'Quem confirma os horários é a equipe', HANDOFF_MARKER]) assert.ok(p.includes(s), s)
    assert.doesNotMatch(p, /Combinado! 😊/)
  })
  it('agenda: confirmação padrão (com exceção pelas instruções); desligada cria ao escolher; remarcar/cancelar confirmam sempre', () => {
    const ag = (confirmar?: boolean) => buildSystemPrompt({ ...base, servicos: [{ nome: 'Corte', duracaoMin: 30 }], agenda: { calendario: 'x', clienteNome: null, ...(confirmar === undefined ? {} : { confirmar }) } })
    const on = ag()
    assert.match(on, /NÃO crie ainda/)
    assert.match(on, /EXCEÇÃO: se as Instruções do dono do negócio disserem claramente para marcar direto/)
    assert.match(on, /pergunte o nome/)
    const off = ag(false)
    assert.doesNotMatch(off, /NÃO crie ainda/)
    assert.match(off, /chame criar_agendamento na mesma hora/)
    for (const p of [on, off]) {
      assert.match(p, /Remarcar ou cancelar \(SEMPRE com confirmação/)
      assert.match(p, /Nunca ofereça horário que a ferramenta não devolveu/)
      assert.match(p, /Marcado: amanhã às 16h\./)
    }
  })
})

describe('confirmação antes de marcar dispensada pelas instruções do dono', () => {
  const sim = [
    'Quando o cliente escolher um horário, pode marcar direto, sem pedir confirmação.',
    'Não ofereça descontos. Pode marcar direto.',
    'Não precisa pedir confirmação antes de agendar.',
    'No hace falta pedir confirmación, agenda directo.',
    'Book it right away when they pick a time.',
  ]
  const nao = [
    '',
    'Nunca marque sem confirmar com o cliente.',
    'Antes de confirmar um pedido ou agendamento, confirme os detalhes com o cliente.',
    'Never book without confirmation.',
  ]
  for (const t of sim) it(`dispensa: ${t}`, () => assert.equal(ownerSkipsBookingConfirmation(t), true))
  for (const t of nao) it(`mantém: ${JSON.stringify(t)}`, () => assert.equal(ownerSkipsBookingConfirmation(t), false))
  it('com a instrução escrita o prompt usa o fluxo sem confirmação, mesmo com o interruptor ligado', () => {
    const p = buildSystemPrompt({
      empresa: 'Studio X',
      agente: { nome: 'Bia', tom: 'Amigável', prompt: 'Pode marcar direto, sem pedir confirmação.' },
      kb: [],
      handoffRules: [],
      servicos: [{ nome: 'Corte', duracaoMin: 30 }],
      agenda: { calendario: 'x', clienteNome: 'Ana', confirmar: true },
    })
    assert.match(p, /chame criar_agendamento na mesma hora/)
    assert.match(p, /Remarcar ou cancelar \(SEMPRE com confirmação/)
  })
})

describe('ritmo natural', () => {
  it('1,5 s + 35 ms por caractere, teto de 8 s', () => {
    assert.equal(typingDelayMs(''), 1500)
    assert.equal(typingDelayMs('x'.repeat(100)), 5000)
    assert.equal(typingDelayMs('x'.repeat(1000)), 8000)
  })
})
