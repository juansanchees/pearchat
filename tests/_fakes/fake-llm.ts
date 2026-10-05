// Servidor FALSO compatível com chat/completions da OpenAI (texto, ferramentas e modos de falha), só em 127.0.0.1.
// Origem: .claude/tmp/hardtest-a/fakellm.ts + .claude/tmp/etapa-ia-agenda/fake.ts (sem o modo "proxy" para o modelo real).
// Uso: const llm = await startFakeLlm(3022); process.env.OPENAI_BASE_URL = llm.url; process.env.OPENAI_API_KEY = 'chave-falsa'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type LlmRequest = {
  model?: string
  messages: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[]
  tools?: { function: { name: string } }[]
}

export type LlmReply =
  | { text: string; delayMs?: number }
  | { tools: { name: string; args: unknown }[]; delayMs?: number }
  | { status: number; delayMs?: number }
  | { hang: true }
  | { empty: true }

export type LlmHandler = (req: LlmRequest, n: number) => LlmReply | Promise<LlmReply>

/** Texto da última mensagem do cliente (role user) de um pedido. */
export const lastUserText = (req: LlmRequest): string => {
  const m = [...req.messages].reverse().find((x) => x.role === 'user')
  return typeof m?.content === 'string' ? m.content : ''
}

export const echoHandler: LlmHandler = (req, n) => ({ text: `Resposta ${n}: ${lastUserText(req).replace(/\n/g, ' | ')}` })

export async function startFakeLlm(port = 0, initial: LlmHandler = echoHandler) {
  let handler = initial
  const reqs: LlmRequest[] = []
  let active = 0
  let peak = 0
  const sockets = new Set<import('node:net').Socket>()
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      let body: LlmRequest = { messages: [] }
      try {
        body = JSON.parse(raw) as LlmRequest
      } catch {
        // corpo inválido: segue com vazio
      }
      reqs.push(body)
      active++
      peak = Math.max(peak, active)
      const done = () => {
        active = Math.max(0, active - 1)
      }
      const send = (status: number, payload: unknown) => {
        done()
        if (res.writableEnded || res.destroyed) return
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      res.on('close', () => {
        if (!res.writableEnded) done()
      })
      const r = await handler(body, reqs.length)
      if ('hang' in r) return
      if ('delayMs' in r && r.delayMs) await new Promise((x) => setTimeout(x, r.delayMs))
      if ('status' in r) return send(r.status, { error: { message: 'simulado' } })
      if ('empty' in r) return send(200, { choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] })
      if ('tools' in r) {
        return send(200, {
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: r.tools.map((t, i) => ({ id: `call_${reqs.length}_${i}`, type: 'function', function: { name: t.name, arguments: typeof t.args === 'string' ? t.args : JSON.stringify(t.args) } })),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        })
      }
      return send(200, { choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } })
    })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  const real = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${real}/v1`,
    reqs,
    get calls() {
      return reqs.length
    },
    /** Maior número de pedidos atendidos ao mesmo tempo. */
    get peak() {
      return peak
    },
    set(h: LlmHandler) {
      handler = h
    },
    reset() {
      reqs.length = 0
      peak = active
    },
    async close() {
      for (const s of Array.from(sockets)) s.destroy()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }
}

export type FakeLlm = Awaited<ReturnType<typeof startFakeLlm>>
