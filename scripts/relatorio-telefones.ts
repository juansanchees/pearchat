// Relatório SOMENTE LEITURA de telefones suspeitos nos contatos, por espaço (workspace).
//
//   npx tsx scripts/relatorio-telefones.ts
//   node /tmp/pearchat-pg/test-env.mjs --schema b -- npx tsx scripts/relatorio-telefones.ts   (ambiente de teste da nuvem)
//
// - NUNCA grava: só faz SELECT em Contact (telefone e workspaceId). Nenhum UPDATE/DELETE/INSERT, nenhuma chamada externa.
// - Imprime só contagens e exemplos MASCARADOS (ex.: "+55 11 9****-**21"); nunca o número inteiro, nome, e-mail ou URL do banco.
// - Opera no banco apontado por DATABASE_URL: em produção, rode no servidor e SÓ com autorização do dono; o resultado serve
//   para decidir com o dono o que corrigir (nada é corrigido aqui).
// - Categorias (um contato cai em no máximo uma, na ordem abaixo):
//     lid        mais de 15 dígitos: um LID do WhatsApp gravado como telefone (E.164 tem no máximo 15)
//     ddd        "+55" + 10 ou 11 dígitos cujo DDD não é brasileiro válido (provável número de outro país com 55 inventado)
//     forma      "+55" + 10 ou 11 dígitos com DDD válido, mas na forma de outro país (11 dígitos sem o 9 de celular, 10 dígitos
//                começando por 0 ou 1): parece mexicano (com o 1) ou argentino (com o 9) com 55 na frente
import { loadEnvConfig } from '@next/env'
import { formatPhoneDisplay, isBrazilianDdd, MAX_PHONE_DIGITS, ddiOf, onlyDigits } from '../src/lib/phone'

export type Suspeita = 'lid' | 'ddd' | 'forma'

/** Classifica um telefone gravado; null = nada suspeito. Pura (testada em tests/internacional/telefone.test.ts). */
export function classificarTelefone(telefone: string | null | undefined): Suspeita | null {
  const d = onlyDigits(telefone ?? '')
  if (!d) return null
  if (d.length > MAX_PHONE_DIGITS) return 'lid'
  if (!d.startsWith('55')) return null
  const rest = d.slice(2)
  if (rest.length !== 10 && rest.length !== 11) return null
  if (!isBrazilianDdd(rest.slice(0, 2))) return 'ddd'
  const third = rest[2] ?? ''
  if (rest.length === 11 ? third !== '9' : third === '0' || third === '1') return 'forma'
  return null
}

/** "+5511987654321" -> "+55 11 9****-**21": mantém o DDI, o DDD e o primeiro dígito, e os dois últimos. */
export function mascararTelefone(telefone: string): string {
  const d = onlyDigits(telefone)
  const head = d.length > MAX_PHONE_DIGITS ? 3 : (ddiOf(d)?.length ?? 0) + 3
  const shown = d.length > MAX_PHONE_DIGITS ? `+${d}` : formatPhoneDisplay(`+${d}`)
  let i = 0
  return shown.replace(/\d/g, (c) => (i++ < head || i > d.length - 2 ? c : '*'))
}

const ROTULO: Record<Suspeita, string> = {
  lid: 'mais de 15 dígitos (LID gravado como telefone)',
  ddd: '+55 com DDD brasileiro inexistente',
  forma: '+55 na forma de outro país (parece mexicano/argentino)',
}
const CATEGORIAS: Suspeita[] = ['lid', 'ddd', 'forma']
const EXEMPLOS = 3
const LOTE = 2000

type Agg = { total: number; contagem: Record<Suspeita, number>; exemplos: Record<Suspeita, string[]> }
const novo = (): Agg => ({
  total: 0,
  contagem: { lid: 0, ddd: 0, forma: 0 },
  exemplos: { lid: [], ddd: [], forma: [] },
})

async function main() {
  loadEnvConfig(process.cwd())
  const { db } = await import('../src/lib/db')
  try {
    const porEspaco = new Map<string, Agg>()
    let cursor: string | undefined
    for (;;) {
      const rows = await db.contact.findMany({
        where: { telefone: { not: null } },
        select: { id: true, workspaceId: true, telefone: true },
        orderBy: { id: 'asc' },
        take: LOTE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (!rows.length) break
      for (const r of rows) {
        const agg = porEspaco.get(r.workspaceId) ?? novo()
        porEspaco.set(r.workspaceId, agg)
        agg.total++
        const s = classificarTelefone(r.telefone)
        if (!s) continue
        agg.contagem[s]++
        if (agg.exemplos[s].length < EXEMPLOS) agg.exemplos[s].push(mascararTelefone(r.telefone ?? ''))
      }
      cursor = rows[rows.length - 1].id
    }

    const ddis = new Map((await db.workspace.findMany({ select: { id: true, ddiPadrao: true } })).map((w) => [w.id, w.ddiPadrao]))
    let suspeitos = 0
    let comTelefone = 0
    console.log(`Espaços com contatos com telefone: ${porEspaco.size}`)
    for (const [id, agg] of Array.from(porEspaco.entries()).sort((a, b) => b[1].total - a[1].total)) {
      const n = CATEGORIAS.reduce((s, c) => s + agg.contagem[c], 0)
      suspeitos += n
      comTelefone += agg.total
      console.log(`\nEspaço ${id.slice(0, 8)}… (DDI padrão +${ddis.get(id) ?? '?'}): ${agg.total} contatos com telefone, ${n} suspeitos`)
      for (const c of CATEGORIAS) {
        if (!agg.contagem[c]) continue
        console.log(`  - ${ROTULO[c]}: ${agg.contagem[c]}   ex.: ${agg.exemplos[c].join(' | ')}`)
      }
    }
    console.log(`\nTotal: ${suspeitos} suspeitos em ${comTelefone} contatos com telefone. Nada foi alterado.`)
  } finally {
    await db.$disconnect()
  }
}

// Só roda quando chamado como script (os testes importam as funções acima sem tocar no banco).
if ((process.argv[1] ?? '').endsWith('relatorio-telefones.ts')) {
  main().catch((e) => {
    console.error('Falha ao gerar o relatório:', e instanceof Error ? e.message : 'erro desconhecido')
    process.exit(1)
  })
}
