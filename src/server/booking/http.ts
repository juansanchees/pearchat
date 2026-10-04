import { NextResponse } from 'next/server'
import { clientIp, hashIp, rateAllow } from './security'

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

/** Slug inexistente, link desativado e negócio arquivado respondem EXATAMENTE isto (sem enumeração). */
export const linkIndisponivel = () => json({ error: 'NAO_ENCONTRADO', message: 'Este link de agendamento não está disponível.' }, 404)

export const MSG_GENERICA = 'Não foi possível concluir o agendamento agora. Tente novamente em instantes.'
export const generico = (status = 400) => json({ error: 'INDISPONIVEL', message: MSG_GENERICA }, status)

export const tooMany = () => json({ error: 'MUITAS_TENTATIVAS', message: 'Muitas tentativas. Tente novamente mais tarde.' }, 429)

/** Limite em memória por IP e rota (protege o banco; independente dos limites de negócio). */
export function throttled(req: Request, bucket: string, max: number, windowMs: number): boolean {
  const ip = hashIp(clientIp(req.headers))
  return !rateAllow(`${bucket}:${ip}`, max, windowMs)
}

/** Corpo JSON com limite de tamanho; null se grande demais ou inválido. */
export async function readSmallJson(req: Request, maxBytes = 4096): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > maxBytes) return { ok: false, status: 413 }
  const text = await req.text()
  if (Buffer.byteLength(text) > maxBytes) return { ok: false, status: 413 }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: 400 }
  }
}
