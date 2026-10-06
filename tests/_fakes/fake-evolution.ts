// Evolution API 2.3.7 FALSA (só 127.0.0.1): envio de texto com modos de falha, consulta de mensagens enviadas
// (/chat/findMessages), "digitando" (/chat/sendPresence, registrado e respondido na hora), estado da instância e construtores de payloads de webhook no formato da 2.3.7.
// Origem: servidor falso de tests/lid-contacts.test.ts e .claude/tmp/diag-envio, ampliado para os cenários de envio incerto.
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Comportamento do POST /message/sendText:
 * - ok: entrega e responde 201 com o id;
 * - delay: entrega (se `deliver` != false) e só responde depois de `ms` (o app desiste antes: timeout);
 * - status: NÃO entrega e responde o código (recusa);
 * - drop: entrega e derruba a conexão sem responder (conexão caiu no meio);
 * - garbage: entrega e responde 201 com corpo ilegível.
 */
export type SendMode =
  | { kind: 'ok' }
  | { kind: 'delay'; ms: number; deliver?: boolean }
  | { kind: 'status'; status: number }
  | { kind: 'drop' }
  | { kind: 'garbage' }

export type Delivered = { id: string; number: string; remoteJid: string; text: string; at: number }

export async function startFakeEvolution(port = 0) {
  let sendModes: SendMode[] = [] // fila: um modo por envio; vazia = ok
  let findStatus = 0 // != 0: /chat/findMessages responde este código
  let state = 'open'
  const delivered: Delivered[] = []
  const attempts: { number: string; text: string }[] = []
  const findCalls: string[] = []
  const presences: { number: string; presence: string; delay: number; at: number }[] = []
  let seq = 0
  let onDelivered: ((d: Delivered) => void | Promise<void>) | null = null
  const sockets = new Set<import('node:net').Socket>()

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      let body: Record<string, unknown> = {}
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        // corpo inválido
      }
      const send = (status: number, obj: unknown) => {
        if (res.destroyed) return
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj))
      }
      const url = req.url ?? ''
      if (url.startsWith('/message/sendText')) {
        const number = String(body.number ?? '')
        const text = String(body.text ?? '')
        attempts.push({ number, text })
        const mode = sendModes.shift() ?? { kind: 'ok' }
        if (mode.kind === 'status') return send(mode.status, { status: mode.status, error: 'simulado' })
        const remoteJid = number.includes('@') ? number : `${number}@s.whatsapp.net`
        const d: Delivered = { id: `FAKEEVO${++seq}${Date.now().toString(36).toUpperCase()}`, number, remoteJid, text, at: Date.now() }
        const deliver = mode.kind !== 'delay' || mode.deliver !== false
        if (deliver) {
          delivered.push(d)
          if (onDelivered) await onDelivered(d)
        }
        if (mode.kind === 'delay') await new Promise((r) => setTimeout(r, mode.ms))
        if (mode.kind === 'drop') {
          req.socket.destroy()
          return
        }
        if (mode.kind === 'garbage') return send(201, '<html>ok</html>')
        return send(201, { key: { remoteJid, fromMe: true, id: d.id }, status: 'PENDING', message: { conversation: text } })
      }
      if (url.startsWith('/chat/sendPresence')) {
        // A Evolution real só responde depois do `delay`; aqui responde na hora (o app não espera por ela: usa o próprio timer).
        presences.push({ number: String(body.number ?? ''), presence: String(body.presence ?? ''), delay: Number(body.delay ?? 0), at: Date.now() })
        return send(201, { presence: body.presence })
      }
      if (url.startsWith('/chat/findMessages')) {
        const where = (body.where ?? {}) as { key?: { remoteJid?: string; fromMe?: boolean } }
        const jid = where.key?.remoteJid ?? ''
        findCalls.push(jid)
        if (findStatus) return send(findStatus, { error: 'simulado' })
        const records = delivered
          .filter((m) => m.remoteJid === jid)
          .sort((a, b) => b.at - a.at)
          .map((m) => ({ key: { id: m.id, remoteJid: m.remoteJid, fromMe: true }, message: { conversation: m.text }, messageTimestamp: Math.floor(m.at / 1000), status: 'SERVER_ACK' }))
        return send(200, { messages: { total: records.length, pages: 1, currentPage: 1, records } })
      }
      if (url.startsWith('/instance/connectionState')) return send(200, { instance: { instanceName: 'x', state } })
      if (url.startsWith('/instance/fetchInstances')) return send(200, [{ ownerJid: '5511900000000@s.whatsapp.net', connectionStatus: state }])
      return send(404, { message: 'rota falsa inexistente' })
    })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  const real = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${real}`,
    delivered,
    attempts,
    findCalls,
    /** Pedidos de "digitando" (ritmo natural da IA). */
    presences,
    /** Modos dos próximos envios, em ordem (os seguintes voltam a "ok"). */
    queue(...modes: SendMode[]) {
      sendModes.push(...modes)
    },
    setFindStatus(s: number) {
      findStatus = s
    },
    setState(s: string) {
      state = s
    },
    onDelivered(fn: ((d: Delivered) => void | Promise<void>) | null) {
      onDelivered = fn
    },
    deliveredTo(numberDigits: string) {
      return delivered.filter((d) => d.number.replace(/\D/g, '') === numberDigits.replace(/\D/g, ''))
    },
    reset() {
      sendModes = []
      findStatus = 0
      state = 'open'
      delivered.length = 0
      attempts.length = 0
      findCalls.length = 0
      presences.length = 0
      onDelivered = null
    },
    async close() {
      for (const s of Array.from(sockets)) s.destroy()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }
}

export type FakeEvolution = Awaited<ReturnType<typeof startFakeEvolution>>

// ---------------------------------------------------------------- Payloads de webhook (formato da 2.3.7)

const envelope = (event: string, instance: string, data: unknown) => ({
  event,
  instance,
  data,
  destination: 'http://127.0.0.1/api/wa/evolution',
  date_time: new Date().toISOString(),
  sender: '5511900000000@s.whatsapp.net',
  server_url: 'http://127.0.0.1',
  apikey: 'chave-da-instancia-falsa',
})

let evoSeq = 0
export const evoId = () => `3EB0${Date.now().toString(16).toUpperCase()}${(evoSeq++).toString(16).toUpperCase()}`

export function evoUpsert(instance: string, o: { remoteJid: string; message: Record<string, unknown>; id?: string; fromMe?: boolean; pushName?: string; ts?: number }) {
  return envelope('messages.upsert', instance, {
    key: { remoteJid: o.remoteJid, fromMe: o.fromMe ?? false, id: o.id ?? evoId() },
    pushName: o.pushName ?? 'Cliente Teste',
    message: o.message,
    messageType: Object.keys(o.message)[0] ?? 'conversation',
    messageTimestamp: o.ts ?? Math.floor(Date.now() / 1000),
    source: 'android',
  })
}

/** SEND_MESSAGE: eco de um envio feito pela API (o próprio PearChat). */
export function evoSendMessage(instance: string, d: { id: string; remoteJid: string; text: string; at?: number }) {
  return envelope('send.message', instance, {
    key: { remoteJid: d.remoteJid, fromMe: true, id: d.id },
    message: { conversation: d.text },
    messageType: 'conversation',
    messageTimestamp: Math.floor((d.at ?? Date.now()) / 1000),
    status: 'PENDING',
  })
}

export function evoConnection(instance: string, state: 'open' | 'close' | 'connecting', statusReason?: number) {
  return envelope('connection.update', instance, { instance, state, ...(statusReason !== undefined ? { statusReason } : {}) })
}

export function evoStatus(instance: string, o: { keyId: string; status: string; remoteJid: string; fromMe?: boolean }) {
  return envelope('messages.update', instance, { keyId: o.keyId, remoteJid: o.remoteJid, fromMe: o.fromMe ?? true, status: o.status })
}
