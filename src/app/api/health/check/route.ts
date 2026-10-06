import { getCheckResult } from '../_lib/collect'
import { tokenMatches } from '../_lib/shared'

export const dynamic = 'force-dynamic'

// Verificação para MONITOR EXTERNO (UptimeRobot, Better Stack...): um endereço só, que checa o site E o que importa por dentro.
//   GET /api/health/check?token=<HEALTH_TOKEN>      (também aceita o cabeçalho x-health-token)
//   200 "OK"                                                     tudo certo
//   503 "PROBLEMA: whatsapp_desconectado=1 fila_parada=3 ..."    algo crítico falhou (só categorias e contagens)
//   404                                                          sem token ou token errado (a rota "não existe" para quem não tem o token)
// O que é crítico está em _lib/evaluate.ts. Sem dados pessoais. Resultado em cache de ~30 s. O Caddy não registra a query
// string nos logs de acesso (o token vai na URL porque o plano grátis do UptimeRobot não manda cabeçalhos).
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' }

export async function GET(req: Request): Promise<Response> {
  const given = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-health-token')
  if (!tokenMatches(given)) return new Response('Not Found', { status: 404, headers: BASE_HEADERS })
  const { problems } = await getCheckResult()
  if (problems.length === 0) return new Response('OK', { status: 200, headers: BASE_HEADERS })
  return new Response(`PROBLEMA: ${problems.join(' ')}`, { status: 503, headers: BASE_HEADERS })
}

// Alguns monitores usam HEAD: mesmo status, sem corpo.
export async function HEAD(req: Request): Promise<Response> {
  const r = await GET(req)
  return new Response(null, { status: r.status, headers: r.headers })
}
