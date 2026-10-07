// Servidor HTTP FALSO, só para o teste do monitor (selftest-http.sh). Não faz parte do deploy.
//   node fake-server.mjs <porta> <arquivo-de-modo> <arquivo-de-saida>
// Modo (lido a cada requisição, 1ª linha do arquivo): up | down | ruim
//   GET /login               200 (up/ruim) ou 503 (down)
//   GET /api/health          com x-health-token: detalhes completos; sem token: só {ok,db}; 503 no modo down
//   POST /hook, /bot<TOKEN>/sendMessage, /ntfy-topic, /emails (Resend)   registram o corpo e os cabeçalhos em <arquivo-de-saida> (uma linha JSON)
import { createServer } from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'

const [, , portArg, modeFile, outFile] = process.argv
const mode = () => {
  try {
    return readFileSync(modeFile, 'utf8').split('\n')[0].trim() || 'up'
  } catch {
    return 'up'
  }
}

const detalhe = (m) => ({
  ok: true,
  db: 'ok',
  versao: 'abcdef123456',
  uptimeSeg: 100,
  agendador: { ativo: true, ultimoTick: '2026-10-05T10:00:00.000Z', idadeTickSeg: 3 },
  jobsPresos: { ia: 0, followUp: 0, soma: 0, acimaDeMin: 10 },
  whatsapp: { conectados: 1, desconectados: m === 'ruim' ? 2 : 0, total: m === 'ruim' ? 3 : 1 },
  filas: { pendentesIa: 1, pendentesFollowUp: 0 },
  alertas: {
    waDesconectadosLongos: m === 'ruim' ? 2 : 0,
    waLimiteMin: 30,
    falhasEnvio15min: m === 'ruim' ? 9 : 0,
    iaErroCredito30min: m === 'ruim' ? 3 : 0,
  },
  inboxTabela: 'WebhookInbox',
  inboxPendentes: m === 'ruim' ? 500 : 0,
  inboxMaisAntigoSeg: m === 'ruim' ? 3000 : 0,
})

createServer((req, res) => {
  const m = mode()
  const url = req.url ?? '/'
  if (req.method === 'GET' && url.startsWith('/login')) {
    res.writeHead(m === 'down' ? 503 : 200).end('login')
    return
  }
  if (req.method === 'GET' && url.startsWith('/api/health')) {
    if (m === 'down') {
      res.writeHead(503, { 'content-type': 'application/json' }).end('{"ok":false,"db":"erro"}')
      return
    }
    const tok = req.headers['x-health-token']
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(tok ? detalhe(m) : { ok: true, db: 'ok' }))
    return
  }
  if (req.method === 'POST') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      appendFileSync(
        outFile,
        JSON.stringify({ path: url, headers: { title: req.headers.title, priority: req.headers.priority, tags: req.headers.tags, ct: req.headers['content-type'], auth: req.headers.authorization ? 'sim' : 'nao' }, body: Buffer.concat(chunks).toString('utf8') }) + '\n',
      )
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
    return
  }
  res.writeHead(404).end()
}).listen(Number(portArg), '127.0.0.1', () => console.log('pronto'))
