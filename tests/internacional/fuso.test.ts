// Onda 2, etapa FUSO: cálculos "de parede" no fuso do ESPAÇO (Workspace.timezone).
// Rode com: node /tmp/pearchat-pg/test-env.mjs --schema a -- npx tsx --test tests/internacional/fuso.test.ts
// A maior parte não usa banco; o bloco final (schema de teste) cria 2 espaços, um no México e outro em Brasília.
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { db } from '../../src/lib/db'
import { hmOf, nextHourTz, startOfDayTz, tzOffsetString, tzParts, ymdOf, zonedToInstant } from '../../src/lib/timezone'
import { silenceEnd } from '../../src/server/engine/util'
import { miniCalendar } from '../../src/server/agent/tools'
import { buildSystemPrompt } from '../../src/server/agent/prompt'
import { diaLabel, horaLabel } from '../../src/server/engine/reminders'
import { diaConfirmacao } from '../../src/server/calendar/confirmation'
import { localIso, parseLocalInstant, quandoExtenso } from '../../src/server/calendar/scheduling'
import { slotsForDay, slotsForWindow, windowDates } from '../../src/server/booking/availability'
import { agentMayReplyAt, formatAgora } from '../../src/server/engine/rules'
import { adjustToSendWindow } from '../../src/server/engine/followup'
import { normalizeGoogleEvent } from '../../src/server/calendar/google'
import { compute, periodBounds } from '../../src/server/results/service'
import { quandoAgenda } from '../../src/server/notifications/format'
import { desdeLabel, rotuloDia } from '../../src/components/notifications/time'
import { defaultDispData, toCampanha } from '../../src/components/drawers/view'

const SP = 'America/Sao_Paulo'
const MX = 'America/Mexico_City' // UTC-6 o ano todo desde 2022
const MAD = 'Europe/Madrid' // horário de verão: 29/03/2026 (02h -> 03h) e 25/10/2026 (03h -> 02h)
const iso = (d: Date) => d.toISOString()

// Quarta, 07/10/2026, 21:00 no México = quinta, 08/10, 00:00 em Brasília = 03:00Z.
const NOITE_MX = new Date('2026-10-08T03:00:00Z')

describe('módulo de fuso (@/lib/timezone)', () => {
  it('parede -> instante e volta: Brasília (UTC-3) e México (UTC-6)', () => {
    assert.equal(iso(zonedToInstant('2026-10-08', '08:00', SP)), '2026-10-08T11:00:00.000Z')
    assert.equal(iso(zonedToInstant('2026-10-08', '08:00', MX)), '2026-10-08T14:00:00.000Z')
    assert.equal(iso(zonedToInstant('2026-07-01', '08:00', MX)), '2026-07-01T14:00:00.000Z') // sem horário de verão
    const p = tzParts(NOITE_MX, MX)
    assert.deepEqual([p.ymd, p.hour, p.dow], ['2026-10-07', 21, 3])
    assert.deepEqual([tzParts(NOITE_MX, SP).ymd, tzParts(NOITE_MX, SP).hour], ['2026-10-08', 0])
    assert.equal(tzOffsetString(NOITE_MX, MX), '-06:00')
  })

  it('horário de verão (Madri): virada sem hora errada', () => {
    // Antes e depois das viradas: deslocamento certo de cada lado.
    assert.equal(iso(zonedToInstant('2026-03-28', '08:00', MAD)), '2026-03-28T07:00:00.000Z')
    assert.equal(iso(zonedToInstant('2026-03-29', '08:00', MAD)), '2026-03-29T06:00:00.000Z')
    assert.equal(iso(zonedToInstant('2026-10-25', '08:00', MAD)), '2026-10-25T07:00:00.000Z')
    // 02:30 de 29/03 não existe: cai para depois do salto (03:30 de verão), nunca para um instante que mostre outro dia.
    const pulo = zonedToInstant('2026-03-29', '02:30', MAD)
    assert.equal(hmOf(pulo, MAD), '03:30')
    assert.equal(ymdOf(pulo, MAD), '2026-03-29')
    // 02:30 de 25/10 existe duas vezes: o resultado é uma delas (relógio volta a marcar 02:30).
    const dupla = zonedToInstant('2026-10-25', '02:30', MAD)
    assert.equal(hmOf(dupla, MAD), '02:30')
    // Meia-noite de um dia de 23 h e o dia seguinte.
    assert.equal(iso(startOfDayTz(new Date('2026-03-29T12:00:00Z'), MAD)), '2026-03-28T23:00:00.000Z')
    assert.equal(iso(nextHourTz(new Date('2026-03-29T00:30:00Z'), 8, MAD)), '2026-03-29T06:00:00.000Z')
  })

  it('nextHourTz: hoje se ainda não passou, senão amanhã (relógio do espaço)', () => {
    assert.equal(iso(nextHourTz(NOITE_MX, 8, MX)), '2026-10-08T14:00:00.000Z') // 21h MX -> 8h do dia seguinte
    assert.equal(iso(nextHourTz(NOITE_MX, 22, MX)), '2026-10-08T04:00:00.000Z') // 22h do mesmo dia no México
    assert.equal(iso(nextHourTz(NOITE_MX, 8, SP)), '2026-10-08T11:00:00.000Z')
  })
})

describe('motor no fuso do espaço', () => {
  const cfg = (timezone: string) => ({ disparosSilencioAtivo: true, disparosSilencioInicio: 21, disparosSilencioFim: 8, timezone })

  it('silêncio 21→8: às 23h do México termina às 8h do México', () => {
    const d = new Date('2026-10-08T05:00:00Z') // 23:00 MX
    assert.equal(iso(silenceEnd(d, cfg(MX))!), '2026-10-08T14:00:00.000Z')
  })

  it('silêncio: 20h no México não é silêncio lá, mas 23h em Brasília é', () => {
    const d = new Date('2026-10-08T02:00:00Z') // 20:00 MX = 23:00 SP
    assert.equal(silenceEnd(d, cfg(MX)), null)
    assert.equal(iso(silenceEnd(d, cfg(SP))!), '2026-10-08T11:00:00.000Z')
    assert.equal(iso(silenceEnd(d, { ...cfg(SP), timezone: null })!), '2026-10-08T11:00:00.000Z') // sem fuso = Brasília
  })

  it('follow-up: a janela 21h–8h é a do espaço', () => {
    const d = new Date('2026-10-08T02:00:00Z') // 20:00 MX, 23:00 SP
    assert.equal(iso(adjustToSendWindow(d, MX)), iso(d))
    assert.equal(iso(adjustToSendWindow(d, SP)), '2026-10-08T11:00:00.000Z')
  })

  it('horário de atendimento do agente ("fora do expediente") no relógio do espaço', () => {
    const at = new Date('2026-10-07T23:00:00Z') // quarta: 17:00 MX (aberto), 20:00 SP (fechado)
    const exp = 'Seg a sex, 8h às 18h'
    assert.equal(agentMayReplyAt('fora_expediente', exp, at, MX), false)
    assert.equal(agentMayReplyAt('fora_expediente', exp, at, SP), true)
    // Fim de semana: o mesmo instante é sábado em Brasília e ainda sexta no México.
    const sab = new Date('2026-10-10T04:00:00Z') // sábado 01:00 SP, sexta 22:00 MX
    assert.equal(agentMayReplyAt('fins_de_semana', null, sab, SP), true)
    assert.equal(agentMayReplyAt('fins_de_semana', null, sab, MX), false)
  })

  it('"amanhã" dos lembretes e da confirmação pelo calendário do espaço', () => {
    const inicio = new Date('2026-10-08T16:00:00Z') // 10:00 MX, 13:00 SP
    assert.equal(diaLabel(inicio, NOITE_MX, MX), 'amanhã')
    assert.equal(diaLabel(inicio, NOITE_MX, SP), 'hoje')
    assert.equal(horaLabel(inicio, MX), '10:00')
    assert.equal(diaConfirmacao(inicio, NOITE_MX, MX), 'amanhã')
    assert.equal(diaConfirmacao(new Date('2026-10-10T16:00:00Z'), NOITE_MX, MX), 'sábado (10/10)')
  })
})

describe('IA no fuso do espaço', () => {
  it('miniCalendar: no México ainda é quarta quando em UTC já é quinta', () => {
    const cal = miniCalendar(NOITE_MX, MX, 3)
    assert.equal(cal, '2026-10-07 = quarta-feira (hoje); 2026-10-08 = quinta-feira (amanhã); 2026-10-09 = sexta-feira')
    assert.match(miniCalendar(NOITE_MX, SP, 1), /^2026-10-08 = quinta-feira \(hoje\)$/)
  })

  it('"Agora" e nome do fuso no prompt; horários das ferramentas no relógio do negócio', () => {
    assert.equal(formatAgora(NOITE_MX, MX), 'quarta-feira, 07/10/2026, 21:00')
    const base = { empresa: 'Loja', agente: { nome: 'Ana', tom: 'Amigável' as const, prompt: '' }, kb: [], handoffRules: [] }
    const mx = buildSystemPrompt({ ...base, agora: formatAgora(NOITE_MX, MX), fuso: MX })
    assert.match(mx, /Agora \(horário do negócio: Cidade do México \(Centro\), UTC-6\): quarta-feira, 07\/10\/2026, 21:00/)
    assert.doesNotMatch(mx, /Brasília|São Paulo/)
    assert.match(buildSystemPrompt({ ...base, agora: 'x' }), /Agora \(horário do negócio: Brasília/)
    const inicio = parseLocalInstant('2026-10-08T15:00', MX)!
    assert.equal(iso(inicio), '2026-10-08T21:00:00.000Z')
    assert.equal(localIso(inicio, MX), '2026-10-08T15:00')
    assert.equal(quandoExtenso(inicio, MX), 'quinta-feira, 8 de outubro, às 15:00')
  })
})

describe('agenda e link público', () => {
  const antes = new Date('2026-10-01T12:00:00Z')

  it('mesma grade 08:00–18:00, instantes diferentes: México 08:00 = 14:00Z, Brasília 08:00 = 11:00Z', () => {
    const mx = slotsForDay('2026-10-08', 60, [], 0, MX, antes)
    const sp = slotsForDay('2026-10-08', 60, [], 0, SP, antes)
    assert.equal(mx[0], '08:00')
    assert.equal(sp[0], '08:00')
    // Ocupado 14:00–15:00Z: 08:00 do México some; em Brasília some 11:00.
    const busy = [{ start: new Date('2026-10-08T14:00:00Z'), end: new Date('2026-10-08T15:00:00Z') }]
    assert.ok(!slotsForDay('2026-10-08', 60, busy, 0, MX, antes).includes('08:00'))
    assert.ok(!slotsForDay('2026-10-08', 60, busy, 0, SP, antes).includes('11:00'))
    assert.ok(slotsForDay('2026-10-08', 60, busy, 0, SP, antes).includes('08:00'))
  })

  it('janela de dias começa no "hoje" do espaço', () => {
    assert.deepEqual(windowDates(2, MX, NOITE_MX), ['2026-10-07', '2026-10-08'])
    assert.deepEqual(windowDates(2, SP, NOITE_MX), ['2026-10-08', '2026-10-09'])
  })

  it('evento de dia inteiro do Google vai de meia-noite a meia-noite do espaço', () => {
    const ev = normalizeGoogleEvent({ id: 'g1', summary: 'Feriado', start: { date: '2026-10-08' }, end: { date: '2026-10-09' } }, 'cal', MX)!
    assert.equal(iso(ev.inicio), '2026-10-08T06:00:00.000Z')
    assert.equal(iso(ev.fim), '2026-10-09T06:00:00.000Z')
  })

  it('período do painel de resultados termina no "hoje" do espaço', () => {
    const b = periodBounds(7, NOITE_MX, MX)
    assert.equal(b.ate, '2026-10-07')
    assert.equal(iso(b.to), '2026-10-08T06:00:00.000Z')
    assert.equal(periodBounds(7, NOITE_MX).ate, '2026-10-08') // padrão = Brasília
  })
})

describe('navegador: sininho e disparos com `tz`', () => {
  const agora = NOITE_MX.getTime()

  it('rotuloDia / desdeLabel / quandoAgenda no fuso do espaço', () => {
    assert.equal(rotuloDia('2026-10-07', agora, MX), 'Hoje')
    assert.equal(rotuloDia('2026-10-07', agora, SP), 'Ontem')
    assert.equal(desdeLabel('2026-10-08T01:00:00Z', agora, MX), '19:00')
    assert.equal(desdeLabel('2026-10-08T01:00:00Z', agora, SP), 'ontem, 22:00')
    assert.equal(quandoAgenda('2026-10-08T16:00:00Z', agora, MX), 'amanhã, 10:00')
    assert.equal(quandoAgenda('2026-10-08T16:00:00Z', agora), 'hoje, 13:00') // padrão = Brasília
  })

  it('disparo agendado e valor inicial do campo no fuso do espaço', () => {
    assert.equal(defaultDispData(NOITE_MX, MX), '2026-10-08T10:00')
    assert.equal(defaultDispData(NOITE_MX, SP), '2026-10-09T10:00')
    const c = { id: 'c', lista: 'todos', listaNome: 'Todos', mensagem: '', templateId: null, status: 'agendada' as const, total: 1, enviadas: 0, respostas: 0, intervalo: null, scheduledAt: '2026-10-08T16:00:00.000Z', createdAt: '2026-10-01T12:00:00.000Z' }
    assert.equal(toCampanha(c, MX).data, 'Agendada para 08/10, 10:00')
    assert.equal(toCampanha(c, SP).data, 'Agendada para 08/10, 13:00')
  })
})

// ---- Com banco (schema de teste) ----
const comBanco = !!process.env.DATABASE_URL && /schema=pearchat_test_/.test(process.env.DATABASE_URL)
const orgs: string[] = []
after(async () => {
  if (comBanco) {
    for (const id of orgs) {
      await db.workspace.deleteMany({ where: { organizationId: id } })
      await db.organization.deleteMany({ where: { id } })
    }
  }
  await db.$disconnect()
})

describe('com banco: dois espaços, fusos diferentes', { skip: !comBanco }, () => {
  async function espaco(timezone: string) {
    const org = await db.organization.create({ data: { nome: `Fuso ${timezone}` } })
    orgs.push(org.id)
    return db.workspace.create({ data: { nome: `Loja ${timezone}`, organizationId: org.id, timezone } })
  }

  it('página pública: horários livres diferentes para o mesmo instante', async () => {
    const [mx, sp] = await Promise.all([espaco(MX), espaco(SP)])
    const cfg = { antecedenciaMin: 0, diasAFrente: 2 }
    // Quarta 07/10, 15:01 UTC = 09:01 no México e 12:01 em Brasília.
    const now = new Date('2026-10-07T15:01:00Z')
    const livresMx = await slotsForWindow(mx.id, 60, { ...cfg, timezone: MX }, now)
    const livresSp = await slotsForWindow(sp.id, 60, { ...cfg, timezone: SP }, now)
    assert.deepEqual(Array.from(livresMx.keys()), ['2026-10-07', '2026-10-08'])
    assert.equal(livresMx.get('2026-10-07')![0], '09:30') // 09:00 já começou no México
    assert.equal(livresSp.get('2026-10-07')![0], '12:30') // em Brasília já é meio-dia
  })

  it('resultados: a mensagem das 21h do México conta no dia 07 lá e no dia 08 em Brasília', async () => {
    const [mx, sp] = await Promise.all([espaco(MX), espaco(SP)])
    for (const ws of [mx, sp]) {
      const contact = await db.contact.create({ data: { workspaceId: ws.id, nome: 'Cliente', telefone: `+5215${Date.now() % 1e8}` } })
      const conv = await db.conversation.create({ data: { workspaceId: ws.id, contactId: contact.id } })
      await db.message.create({ data: { conversationId: conv.id, direction: 'IN', author: 'CLIENTE', body: 'oi', createdAt: NOITE_MX } })
    }
    const agora = new Date('2026-10-08T12:00:00Z')
    const rMx = await compute(mx.id, 7, agora, MX)
    const rSp = await compute(sp.id, 7, agora, SP)
    const dia = (r: typeof rMx, d: string) => r.atendimento.porDia.find((x) => x.dia === d)?.recebidas
    assert.equal(dia(rMx, '2026-10-07'), 1)
    assert.equal(dia(rSp, '2026-10-08'), 1)
    assert.equal(rMx.picos[3][3], 1) // quarta, noite (18h–24h)
    assert.equal(rSp.picos[4][0], 1) // quinta, madrugada
  })
})
