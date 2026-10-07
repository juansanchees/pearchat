// Telefone de qualquer país (etapa FONE da onda 2): normalização, variantes, exibição, máscara, busca e relatório.
// A maior parte é pura (sem banco). O trecho de banco exige um schema de TESTE do Postgres. Rodar:
//   node /tmp/pearchat-pg/test-env.mjs --schema b -- npx tsx --test tests/internacional/telefone.test.ts
// Todos os números abaixo são inventados.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import {
  formatPhoneDisplay,
  maskPhoneInput,
  normalizePhoneE164 as n,
  phoneCandidates,
  phoneInputError,
  phoneVariants,
} from '../../src/lib/phone'
import { toE164 } from '../../src/server/whatsapp/phone'
import { normalizeEvolutionEvent } from '../../src/server/whatsapp/normalize'
import { classificarTelefone, mascararTelefone } from '../../scripts/relatorio-telefones'

describe('normalizePhoneE164', () => {
  it('Brasil com e sem o 9, com máscara, com 0 de tronco, com + e com 00', () => {
    assert.equal(n('11987654321'), '+5511987654321')
    assert.equal(n('1187654321'), '+551187654321') // fixo/antigo de 10 dígitos: não inventa o 9
    assert.equal(n('(11) 98765-4321'), '+5511987654321')
    assert.equal(n('011987654321'), '+5511987654321')
    assert.equal(n('01187654321'), '+551187654321')
    assert.equal(n('+55 11 98765-4321'), '+5511987654321')
    assert.equal(n('005511987654321'), '+5511987654321')
    assert.equal(n('5511987654321'), '+5511987654321') // já com 55: não vira 5555…
    assert.equal(n("'+5511987654321"), '+5511987654321') // célula neutralizada do CSV
  })

  it('México: 10 dígitos com DDI padrão 52 ganha 52 (sem inventar o 1); com DDI padrão 55 NÃO vira +55', () => {
    assert.equal(n('5512345678', '52'), '+525512345678')
    assert.equal(n('55 1234 5678', '52'), '+525512345678')
    assert.equal(n('044 55 1234 5678', '52'), '+525512345678')
    assert.equal(n('5512345678', '55'), null) // comportamento real: rejeita, em vez de gravar +555512345678 (que seria inventar o 55)
    assert.equal(n('+5215512345678'), '+5215512345678') // o 1 fica como está
    assert.equal(n('5215512345678', '55'), '+5215512345678')
    assert.equal(n('525512345678', '55'), '+525512345678')
  })

  it('Argentina, Estados Unidos e outros países', () => {
    assert.equal(n('1155551234', '54'), '+541155551234')
    assert.equal(n('91155551234', '54'), '+5491155551234')
    assert.equal(n('+5491155551234'), '+5491155551234')
    assert.equal(n('2125551234', '1'), '+12125551234')
    assert.equal(n('(212) 555-1234', '1'), '+12125551234')
    assert.equal(n('+12125551234', '55'), '+12125551234')
    assert.equal(n('12125551234', '55'), '+12125551234')
    assert.equal(n('912345678', '351'), '+351912345678')
  })

  it('número já internacional de 12+ dígitos NUNCA ganha 55; lixo vira null', () => {
    for (const raw of ['4915123456789', '351912345678', '525512345678', '5215512345678', '541155551234', '573001234567']) {
      const r = n(raw, '55')
      assert.ok(r && !r.startsWith('+5555') && r === `+${raw}`, `${raw} -> ${r}`)
    }
    assert.equal(n(''), null)
    assert.equal(n('123'), null)
    assert.equal(n('+999'), null)
    assert.equal(n('abc'), null)
    assert.equal(n('+1234567890123456789'), null) // mais de 15 dígitos (LID) nunca é telefone
  })
})

describe('variantes e candidatos', () => {
  it('Brasil com/sem o 9, México com/sem o 1, Argentina com/sem o 9', () => {
    assert.deepEqual(phoneVariants('+5511987654321').sort(), ['+551187654321', '+5511987654321'])
    assert.deepEqual(phoneVariants('+551187654321').sort(), ['+551187654321', '+5511987654321'])
    assert.deepEqual(phoneVariants('+5215512345678').sort(), ['+5215512345678', '+525512345678'])
    assert.deepEqual(phoneVariants('+525512345678').sort(), ['+5215512345678', '+525512345678'])
    assert.deepEqual(phoneVariants('+5491155551234').sort(), ['+541155551234', '+5491155551234'])
    assert.deepEqual(phoneVariants('+541155551234').sort(), ['+541155551234', '+5491155551234'])
    assert.deepEqual(phoneVariants('+12125551234'), ['+12125551234'])
  })

  it('phoneCandidates acha o número local num espaço com DDI padrão 52 (e BR sem o 9 num espaço 55)', () => {
    const mx = phoneCandidates('55 1234 5678', '52')
    assert.ok(mx.includes('+525512345678') && mx.includes('+5215512345678'))
    const br = phoneCandidates('(11) 8765-4321', '55')
    assert.ok(br.includes('+551187654321') && br.includes('+5511987654321'))
    const ja = phoneCandidates('+5215512345678', '55')
    assert.ok(ja.includes('+525512345678') && !ja.some((c) => c.startsWith('+5552')))
  })
})

describe('formatPhoneDisplay', () => {
  const cases: [string, string][] = [
    ['+5511987654321', '+55 11 98765-4321'],
    ['+551187654321', '+55 11 8765-4321'],
    ['+525512345678', '+52 55 1234 5678'],
    ['+523312345678', '+52 33 1234 5678'],
    ['+528112345678', '+52 81 1234 5678'],
    ['+527221234567', '+52 722 123 4567'],
    ['+5215512345678', '+52 1 55 1234 5678'],
    ['+5491155551234', '+54 9 11 5555-1234'],
    ['+541155551234', '+54 11 5555-1234'],
    ['+12125551234', '+1 (212) 555-1234'],
    ['+351912345678', '+351 912 345 678'],
    ['+34612345678', '+34 612 345 678'],
    ['+573001234567', '+57 300 123 4567'],
    ['+56912345678', '+56 9 1234 5678'],
    ['+51987654321', '+51 987 654 321'],
    ['+4915123456789', '+49 151 234 567 89'], // país sem formato próprio: +DDI e dígitos agrupados
    ['+99999', '+99999'], // sem DDI reconhecível: como está
  ]
  for (const [e164, shown] of cases) it(`${e164} -> ${shown}`, () => assert.equal(formatPhoneDisplay(e164), shown))

  it('vazio e LID de mais de 15 dígitos (mostrado como está, sem formato de país)', () => {
    assert.equal(formatPhoneDisplay(null), '')
    assert.equal(formatPhoneDisplay(''), '')
    assert.equal(formatPhoneDisplay('264913750589556999'), '+264913750589556999')
  })
})

describe('campo de telefone (máscara e erro)', () => {
  it('55: (11) 98765-4321, aceita colar com 55 e com +', () => {
    assert.equal(maskPhoneInput('11987654321', '55'), '(11) 98765-4321')
    assert.equal(maskPhoneInput('1187654321', '55'), '(11) 8765-4321')
    assert.equal(maskPhoneInput('5511987654321', '55'), '(11) 98765-4321')
    assert.equal(maskPhoneInput('+34612345678', '55'), '+34 612 345 678')
    assert.equal(phoneInputError('(11) 98765-4321', '55'), null)
    assert.equal(phoneInputError('(11) 9876', '55'), 'Informe o WhatsApp com DDD.')
    assert.equal(phoneInputError('', '55'), 'Informe o WhatsApp.')
    assert.equal(phoneInputError('+999', '55'), 'Esse número internacional não parece válido.')
    assert.equal(phoneInputError('(99) 99999-9999', '55'), 'Esse número não parece válido.')
  })

  it('52: número local mexicano vale; erro pede a cidade ou +país', () => {
    assert.equal(maskPhoneInput('5512345678', '52'), '551 234 5678')
    assert.equal(phoneInputError(maskPhoneInput('5512345678', '52'), '52'), null)
    assert.equal(phoneInputError('5512', '52'), 'Informe o WhatsApp com o código da cidade ou comece por + e o código do país.')
    assert.equal(maskPhoneInput('+525512345678', '52'), '+52 551 234 5678')
  })

  it('1: (212) 555-1234', () => {
    assert.equal(maskPhoneInput('2125551234', '1'), '(212) 555-1234')
    assert.equal(maskPhoneInput('212', '1'), '212')
    assert.equal(phoneInputError('(212) 555-1234', '1'), null)
    assert.equal(phoneInputError('(212) 155-1234', '1'), 'Informe o WhatsApp com o código da cidade ou comece por + e o código do país.')
  })
})

describe('chegada pelo webhook (o JID já vem com DDI)', () => {
  it('toE164 nunca acrescenta DDI', () => {
    assert.equal(toE164('5215512345678'), '+5215512345678')
    assert.equal(toE164('+52 1 55 1234 5678'), '+5215512345678')
    assert.equal(toE164('14155550004'), '+14155550004')
  })

  const evo = (remoteJid: string, extra: Record<string, unknown> = {}) =>
    normalizeEvolutionEvent({
      event: 'messages.upsert',
      instance: 'i',
      data: { key: { remoteJid, fromMe: false, id: 'X1', ...extra }, pushName: 'Teste', message: { conversation: 'oi' }, messageTimestamp: 1_700_000_000 },
    })

  it('JID mexicano e americano chegam como estão; LID vira waUserId; telefone alternativo do LID entra sem 55', () => {
    const mx = evo('5215512345678@s.whatsapp.net')
    assert.ok(mx.kind === 'messages' && mx.inbound[0].from.telefone === '+5215512345678')
    const us = evo('14155550004@s.whatsapp.net')
    assert.ok(us.kind === 'messages' && us.inbound[0].from.telefone === '+14155550004')
    const lid = evo('264900000000001@lid', { remoteJidAlt: '525512345678@s.whatsapp.net' })
    assert.ok(lid.kind === 'messages')
    assert.deepEqual(lid.kind === 'messages' ? lid.inbound[0].from : null, { waUserId: '264900000000001', telefone: '+525512345678' })
    const soLid = evo('264900000000001@lid')
    assert.ok(soLid.kind === 'messages' && soLid.inbound[0].from.telefone === undefined)
  })
})

describe('relatório de telefones suspeitos (classificação)', () => {
  it('classifica LID, DDD inexistente e forma de outro país; o resto não é suspeito', () => {
    assert.equal(classificarTelefone('264900000000001999'), 'lid')
    assert.equal(classificarTelefone('+5500987654321'), 'ddd') // DDD 00
    assert.equal(classificarTelefone('+5510987654321'), 'ddd') // DDD 10 não existe
    assert.equal(classificarTelefone('+555512345678'), 'forma') // 55 + 55 1234 5678 (3º dígito 1): fixo inválido, parece MX
    assert.equal(classificarTelefone('+5551123456789'), 'forma') // 11 dígitos sem o 9 de celular (parece MX com o 1 / AR)
    assert.equal(classificarTelefone('+5511987654321'), null)
    assert.equal(classificarTelefone('+551187654321'), null)
    assert.equal(classificarTelefone('+5215512345678'), null)
    assert.equal(classificarTelefone('+12125551234'), null)
    assert.equal(classificarTelefone(null), null)
  })

  it('mascara tudo menos DDI, DDD, 1º dígito e os dois últimos', () => {
    assert.equal(mascararTelefone('+5511987654321'), '+55 11 9****-**21')
    assert.equal(mascararTelefone('+525512345678'), '+52 55 1*** **78')
    assert.ok(!/\d{5}/.test(mascararTelefone('+264913750589556999')), 'LID nunca sai inteiro')
  })
})

// ---------------------------------------------------------------- com banco (schema de teste)

const temBanco = /^pearchat_test_/.test(new URL(process.env.DATABASE_URL ?? 'postgres://x/y').searchParams.get('schema') ?? '')
describe('com banco: busca por telefone e relatório em dry-run', { skip: !temBanco && 'sem schema de teste' }, () => {
  let wsMx = ''
  let wsBr = ''
  let db: typeof import('../../src/lib/db').db
  before(async () => {
    ;({ db } = await import('../../src/lib/db'))
    wsMx = (await db.workspace.create({ data: { nome: 'Teste FONE MX', ddiPadrao: '52' } })).id
    wsBr = (await db.workspace.create({ data: { nome: 'Teste FONE BR' } })).id
    await db.contact.createMany({
      data: [
        { workspaceId: wsMx, nome: 'Mx1', telefone: '+525512345678', tags: [] },
        { workspaceId: wsMx, nome: 'Mx2', telefone: '+5215587654321', tags: [] },
        { workspaceId: wsBr, nome: 'Br1', telefone: '+5511987654321', tags: [] },
        { workspaceId: wsBr, nome: 'Br2', telefone: '+555512345678', tags: [] }, // suspeito: forma
        { workspaceId: wsBr, nome: 'Br3', telefone: '+5510912345678', tags: [] }, // suspeito: DDD 10
        { workspaceId: wsBr, nome: 'Br4', telefone: '+264900000000001999', tags: [] }, // suspeito: LID
      ],
    })
  })
  after(async () => {
    if (!db) return
    await db.contact.deleteMany({ where: { workspaceId: { in: [wsMx, wsBr] } } })
    await db.workspace.deleteMany({ where: { id: { in: [wsMx, wsBr] } } })
  })

  it('busca por dígitos acha o mexicano digitado sem DDI num espaço 52 (inclusive o gravado com o 1) e o BR sem o 9', async () => {
    const { listContacts } = await import('../../src/server/contacts/queries')
    const mx = await listContacts(wsMx, { q: '55 1234 5678', take: 20 } as never)
    assert.deepEqual(mx.items.map((c) => c.name).sort(), ['Mx1'])
    const mx1 = await listContacts(wsMx, { q: '55 8765 4321', take: 20 } as never)
    assert.deepEqual(mx1.items.map((c) => c.name), ['Mx2'])
    const br = await listContacts(wsBr, { q: '(11) 8765-4321', take: 20 } as never)
    assert.deepEqual(br.items.map((c) => c.name), ['Br1']) // sem o 9: só acha pela variante
  })

  it('o relatório conta os suspeitos por espaço, mascara os exemplos e não altera nada', async () => {
    const antes = await db.contact.count({ where: { workspaceId: { in: [wsMx, wsBr] } } })
    const out = execFileSync('npx', ['tsx', 'scripts/relatorio-telefones.ts'], { encoding: 'utf8', env: process.env })
    const bloco = out.split('\n\n').find((b) => b.includes(wsBr.slice(0, 8))) ?? ''
    assert.match(bloco, /4 contatos com telefone, 3 suspeitos/)
    assert.match(bloco, /LID gravado como telefone\): 1/)
    assert.match(bloco, /DDD brasileiro inexistente: 1/)
    assert.match(bloco, /outro país \(parece mexicano\/argentino\): 1/)
    assert.ok(!out.includes('5512345678') && !out.includes('987654321'), 'nenhum número inteiro na saída')
    assert.equal(await db.contact.count({ where: { workspaceId: { in: [wsMx, wsBr] } } }), antes)
  })
})
