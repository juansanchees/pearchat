import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { hasBadText } from '@/server/messages/api'
import { clientIp, hashIp, hashPhone, signFormToken, verifyFormToken } from '@/server/booking/security'
import { generico, json, linkIndisponivel, linkPausado, readSmallJson, throttled, tooMany } from '@/server/booking/http'
import {
  MAX_OBS,
  cleanLine,
  createPublicBooking,
  getPublicWorkspace,
  hasLink,
  lengthOf,
  listPublicServices,
} from '@/server/booking/public'
import { isValidDateStr } from '@/server/calendar/time'
import { tzLabel, tzOffsetLabel } from '@/lib/timezone'
import { todayIn } from '@/server/booking/availability'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/booking/[slug]  (sem sessão)
 * Só o que a página precisa: nome do negócio, mensagem, serviços ativos e um token de formulário com horário.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  if (throttled(req, 'pub-get', 120, 10 * 60_000)) return tooMany()
  const ws = await getPublicWorkspace(params.slug)
  if (!ws) return linkIndisponivel()
  const servicos = await listPublicServices(ws.id)
  return json({
    negocio: ws.nome,
    mensagem: ws.mensagem,
    servicos,
    diasAFrente: ws.diasAFrente,
    hoje: todayIn(ws.timezone),
    // Fuso do negócio: os horários da página são o relógio de lá (o nome do fuso aparece na página).
    fuso: { id: ws.timezone, nome: tzLabel(ws.timezone), offset: tzOffsetLabel(ws.timezone) },
    ddiPadrao: ws.ddiPadrao,
    token: signFormToken(ws.id),
  })
}

const bodySchema = z
  .object({
    token: z.string().max(200),
    website: z.string().max(200).optional(), // isca (honeypot): pessoas nunca preenchem
    serviceTypeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    date: z.string().refine(isValidDateStr),
    hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    nome: z.string().max(200),
    telefone: z.string().max(40),
    observacao: z.string().max(1000).nullish(),
    aceite: z.literal(true),
  })
  .strict()

/** POST /api/public/booking/[slug]  (sem sessão) -> 201 { agendamento } | 409 CONFLITO | 4xx genérico. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  if (throttled(req, 'pub-post', 30, 10 * 60_000)) return tooMany()
  const ws = await getPublicWorkspace(params.slug)
  if (!ws) return linkIndisponivel()

  const raw = await readSmallJson(req)
  if (!raw.ok) return json({ error: 'INVALIDO', message: 'Pedido inválido.' }, raw.status)
  if (hasBadText(raw.body)) return json({ error: 'INVALIDO', message: 'Pedido inválido.' }, 400)
  const parsed = bodySchema.safeParse(raw.body)
  if (!parsed.success) return json({ error: 'INVALIDO', message: 'Confira os dados informados e tente de novo.' }, 400)
  const b = parsed.data

  // Anti-robô: isca preenchida, token inválido/expirado ou formulário enviado rápido demais. Resposta genérica.
  if (b.website && b.website.trim() !== '') return generico()
  if (verifyFormToken(ws.id, b.token) !== 'ok') return generico()

  const nome = cleanLine(b.nome)
  if (lengthOf(nome) < 2 || lengthOf(nome) > 80) return json({ error: 'INVALIDO', message: 'Informe seu nome (de 2 a 80 caracteres).' }, 422)
  const obs = b.observacao ? cleanLine(b.observacao) : ''
  if (lengthOf(obs) > MAX_OBS) return json({ error: 'INVALIDO', message: `A observação pode ter até ${MAX_OBS} caracteres.` }, 422)
  if (hasLink(nome) || hasLink(obs)) return json({ error: 'INVALIDO', message: 'Não use endereços de internet no nome ou na observação.' }, 422)

  const ipHash = hashIp(clientIp(req.headers))
  const result = await createPublicBooking({
    workspace: ws,
    serviceTypeId: b.serviceTypeId,
    date: b.date,
    hora: b.hora,
    nome,
    telefoneRaw: b.telefone,
    observacao: obs || null,
    ipHash,
    telefoneHash: (e164) => hashPhone(ws.id, e164),
  })
  switch (result.kind) {
    case 'ok': {
      const r = result.resumo
      return json(
        {
          agendamento: {
            negocio: r.negocio,
            servico: r.servico,
            duracaoMin: r.duracaoMin,
            inicio: r.inicio,
            data: r.data,
            hora: r.hora,
            icsUrl: `/api/public/booking/${encodeURIComponent(params.slug)}/ics?t=${encodeURIComponent(r.icsToken)}`,
            whatsappUrl: r.whatsappUrl,
          },
        },
        201,
      )
    }
    case 'conflict':
      return json({ error: 'CONFLITO', message: 'Esse horário acabou de ser reservado, escolha outro.' }, 409)
    case 'limit':
      return generico(429)
    case 'cap':
      // Teto do negócio: o dono já foi avisado. 503 + Retry-After; a página mostra a mensagem.
      return linkPausado()
    case 'invalid':
      return json({ error: 'INVALIDO', message: result.message }, 422)
  }
}
