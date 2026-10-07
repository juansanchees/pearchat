// Duplicados JÁ existentes do mesmo cliente (um contato só com o LID, outro só com o telefone): lista e, com --apply,
// unifica SOMENTE os pares com PROVA nos dados gravados, com a mesma função do recebimento (src/server/contacts/merge.ts).
//
//   npx tsx scripts/unificar-contatos.ts                  (padrão: --dry-run, só lista; não muda nada)
//   npx tsx scripts/unificar-contatos.ts --apply          (unifica os pares com prova, um por transação)
//   ... --workspace <id>                                  (só um espaço)
//
// Prova aceita (nunca nome, foto ou semelhança):
//   1. evento bruto ainda guardado na caixa de entrada dos webhooks (WebhookInbox, cifrado; fica ~3 dias depois de
//      processado e 30 dias se "morto") que traz, no MESMO evento, o LID e o telefone (key.remoteJid @lid +
//      remoteJidAlt/senderPn), e cada um está num contato diferente do espaço;
//   2. a MESMA mensagem do WhatsApp (mesmo id do provedor) gravada nas conversas dos dois contatos.
// O que não tem prova sai como "não unificável automaticamente". A saída é mascarada (telefone e LID parciais, sem nomes).
// Só para o banco de onde a variável DATABASE_URL apontar: confira antes de rodar com --apply.
import { loadEnvConfig } from '@next/env'
import { db } from '../src/lib/db'
import { formatPhoneDisplay } from '../src/lib/phone'
import { chooseKeep, findMergeByProof, identifiersConflict, mergeContacts } from '../src/server/contacts/merge'
import type { MergeResult, ProofRef } from '../src/server/contacts/merge'
import { decrypt } from '../src/server/whatsapp/crypto'
import { normalizeEvolutionEvent, normalizeMetaPayload } from '../src/server/whatsapp/normalize'
import type { ContactRef } from '../src/server/whatsapp/provider'

/** "+5511987654321" -> "+55 11 9****-**21": DDI e DDD/área visíveis, o 1º dígito e os 2 últimos; o resto mascarado. */
export function mascararTelefone(tel: string | null | undefined): string {
  if (!tel) return '(sem telefone)'
  const shown = formatPhoneDisplay(tel) || tel
  const parts = shown.split(' ')
  const head = parts.slice(0, 2).join(' ')
  const rest = parts.slice(2).join(' ')
  const total = rest.replace(/\D/g, '').length
  let seen = 0
  const masked = rest.replace(/\d/g, (d) => {
    seen++
    return seen === 1 || seen > total - 2 ? d : '*'
  })
  return rest ? `${head} ${masked}` : head.replace(/\d(?=\d{2})/g, '*')
}

/** "264900000000556" -> "2649…556". */
export function mascararLid(lid: string | null | undefined): string {
  if (!lid) return '(sem LID)'
  return lid.length <= 7 ? `${lid.slice(0, 2)}…` : `${lid.slice(0, 4)}…${lid.slice(-3)}`
}

export type Par = {
  workspaceId: string
  keepId: string
  dupId: string
  lid: string | null
  telefone: string | null
  provas: string[]
  /** Prova do evento (LID + telefone): reavaliada dentro da transação no --apply. */
  ref?: ProofRef
}

export type SemProva = { workspaceId: string; contactId: string; lid: string; mensagens: number }

export type Relatorio = {
  pares: Par[]
  semProva: SemProva[]
  /** Contatos só com telefone nos espaços que têm contato só com LID (o outro lado possível, sem prova). */
  soTelefone: number
  inbox: { lidas: number; ilegiveis: number; comLidETelefone: number }
}

type RefEvento = { workspaceId: string; ref: ContactRef; at: Date }

/** Lê a caixa de entrada (cifrada) e devolve os identificadores LID + telefone vindos JUNTOS num mesmo evento. */
async function refsDaCaixa(workspaceId: string | undefined, inbox: Relatorio['inbox']): Promise<RefEvento[]> {
  const sessions = await db.whatsAppSession.findMany({
    where: workspaceId ? { workspaceId } : {},
    select: { workspaceId: true, evolutionInstance: true, metaPhoneNumberId: true },
  })
  const byInstance = new Map(sessions.filter((s) => s.evolutionInstance).map((s) => [s.evolutionInstance as string, s.workspaceId]))
  const byPhoneId = new Map(sessions.filter((s) => s.metaPhoneNumberId).map((s) => [s.metaPhoneNumberId as string, s.workspaceId]))
  const out: RefEvento[] = []
  const push = (ws: string | undefined, ref: ContactRef, at: Date) => {
    if (!ws || !ref.waUserId || !ref.telefone) return
    inbox.comLidETelefone++
    out.push({ workspaceId: ws, ref: { waUserId: ref.waUserId, telefone: ref.telefone }, at })
  }
  let cursor: string | undefined
  for (;;) {
    const rows = await db.webhookInbox.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: 200,
      select: { id: true, provider: true, payload: true, receivedAt: true },
    })
    if (!rows.length) break
    cursor = rows[rows.length - 1].id
    for (const row of rows) {
      inbox.lidas++
      let json: unknown
      try {
        json = JSON.parse(decrypt(row.payload))
      } catch {
        inbox.ilegiveis++
        continue
      }
      if (row.provider === 'evolution') {
        const ev = normalizeEvolutionEvent(json)
        if (ev.kind === 'ignored' || !('instance' in ev)) continue
        const ws = byInstance.get(ev.instance)
        if (ev.kind === 'messages') {
          for (const m of ev.inbound) push(ws, m.from, row.receivedAt)
          for (const m of ev.outbound) push(ws, m.to, row.receivedAt)
        } else if (ev.kind === 'sent') {
          for (const m of ev.sent) push(ws, m.to, row.receivedAt)
        } else if (ev.kind === 'history') {
          for (const m of ev.messages) push(ws, m.from, row.receivedAt)
        }
      } else if (row.provider === 'meta') {
        for (const b of normalizeMetaPayload(json)) {
          const ws = byPhoneId.get(b.phoneNumberId)
          for (const m of b.inbound) push(ws, m.from, row.receivedAt)
          for (const m of b.echoes) push(ws, m.to, row.receivedAt)
        }
      }
    }
  }
  return workspaceId ? out.filter((r) => r.workspaceId === workspaceId) : out
}

/** Pares (contato só com LID × contato só com telefone) ligados pela MESMA mensagem do provedor nas duas conversas. */
async function paresPorMensagem(workspaceId: string | undefined) {
  return db.$queryRaw<{ workspaceId: string; lidId: string; telId: string; n: bigint }[]>`
    SELECT a."workspaceId" AS "workspaceId", a."id" AS "lidId", b."id" AS "telId", COUNT(*) AS n
    FROM "Message" ma
    JOIN "Conversation" ca ON ca."id" = ma."conversationId"
    JOIN "Contact" a ON a."id" = ca."contactId"
    JOIN "Message" mb ON mb."providerMessageId" = ma."providerMessageId" AND mb."id" <> ma."id"
    JOIN "Conversation" cb ON cb."id" = mb."conversationId" AND cb."workspaceId" = ca."workspaceId"
    JOIN "Contact" b ON b."id" = cb."contactId"
    WHERE ma."providerMessageId" IS NOT NULL
      AND a."waUserId" IS NOT NULL AND a."telefone" IS NULL
      AND b."telefone" IS NOT NULL AND b."waUserId" IS NULL
      AND (${workspaceId ?? null}::text IS NULL OR a."workspaceId" = ${workspaceId ?? null})
    GROUP BY a."workspaceId", a."id", b."id"`
}

/** Levantamento: não muda nada no banco. */
export async function levantar(opts: { workspaceId?: string } = {}): Promise<Relatorio> {
  const rel: Relatorio = { pares: [], semProva: [], soTelefone: 0, inbox: { lidas: 0, ilegiveis: 0, comLidETelefone: 0 } }
  const pares = new Map<string, Par>()
  const add = (p: Omit<Par, 'provas'>, prova: string) => {
    const key = [p.keepId, p.dupId].sort().join(':')
    const cur = pares.get(key)
    if (cur) {
      if (!cur.provas.includes(prova)) cur.provas.push(prova)
      cur.ref ??= p.ref
    } else pares.set(key, { ...p, provas: [prova] })
  }

  for (const ev of await refsDaCaixa(opts.workspaceId, rel.inbox)) {
    const pair = await findMergeByProof(ev.workspaceId, ev.ref)
    if (!pair) continue
    add({ workspaceId: ev.workspaceId, keepId: pair.keepId, dupId: pair.dupId, lid: ev.ref.waUserId ?? null, telefone: ev.ref.telefone ?? null, ref: ev.ref }, `evento do webhook com LID e telefone (${ev.at.toISOString().slice(0, 10)})`)
  }

  for (const row of await paresPorMensagem(opts.workspaceId)) {
    const [a, b] = await Promise.all([db.contact.findUnique({ where: { id: row.lidId } }), db.contact.findUnique({ where: { id: row.telId } })])
    if (!a || !b || identifiersConflict(a, b)) continue
    const { keep, dup } = chooseKeep(a, b)
    add({ workspaceId: row.workspaceId, keepId: keep.id, dupId: dup.id, lid: a.waUserId, telefone: b.telefone }, `${Number(row.n)} mensagem(ns) com o mesmo id do WhatsApp nas duas conversas`)
  }
  rel.pares = Array.from(pares.values())

  // Sem prova: contatos só com LID que não entraram em nenhum par (o telefone deles é desconhecido).
  const comPar = new Set(rel.pares.flatMap((p) => [p.keepId, p.dupId]))
  const soLid = await db.contact.findMany({
    where: { ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}), waUserId: { not: null }, telefone: null },
    select: { id: true, workspaceId: true, waUserId: true, conversation: { select: { _count: { select: { messages: true } } } } },
    orderBy: [{ workspaceId: 'asc' }, { createdAt: 'asc' }],
  })
  for (const c of soLid) {
    if (comPar.has(c.id) || !c.waUserId) continue
    rel.semProva.push({ workspaceId: c.workspaceId, contactId: c.id, lid: c.waUserId, mensagens: c.conversation?._count.messages ?? 0 })
  }
  const espacos = Array.from(new Set(rel.semProva.map((s) => s.workspaceId)))
  if (espacos.length) rel.soTelefone = await db.contact.count({ where: { workspaceId: { in: espacos }, telefone: { not: null }, waUserId: null } })
  return rel
}

/** Unifica os pares com prova, um por transação (mergeContacts). Pares que já não valem são pulados. */
export async function aplicar(pares: Par[]): Promise<{ par: Par; r: MergeResult | null; erro?: string }[]> {
  const out: { par: Par; r: MergeResult | null; erro?: string }[] = []
  for (const par of pares) {
    try {
      const r = await mergeContacts(par.workspaceId, par.keepId, par.dupId, { origem: 'script', ...(par.ref ? { proof: par.ref } : {}) })
      out.push({ par, r })
    } catch (e) {
      out.push({ par, r: null, erro: e instanceof Error ? e.name : 'erro' })
    }
  }
  return out
}

export function imprimir(rel: Relatorio, print: (s: string) => void = console.log): void {
  print(`Caixa de entrada dos webhooks: ${rel.inbox.lidas} evento(s) lido(s), ${rel.inbox.comLidETelefone} com LID e telefone juntos, ${rel.inbox.ilegiveis} ilegível(is).`)
  print('')
  print(`Pares COM prova (unificáveis): ${rel.pares.length}`)
  for (const p of rel.pares) {
    print(`  espaço ${p.workspaceId}: LID ${mascararLid(p.lid)} × ${mascararTelefone(p.telefone)} -> mantém ${p.keepId}, apaga ${p.dupId}`)
    for (const prova of p.provas) print(`      prova: ${prova}`)
  }
  print('')
  if (!rel.semProva.length) {
    print('Contatos só com LID sem prova: nenhum.')
    return
  }
  print(`Não unificável automaticamente (só LID, sem prova nos dados gravados): ${rel.semProva.length}`)
  print(`  (há ${rel.soTelefone} contato(s) só com telefone nesses espaços; sem um evento que traga LID e telefone juntos, não dá para saber qual é qual)`)
  const LIMITE = 50
  for (const s of rel.semProva.slice(0, LIMITE)) print(`  espaço ${s.workspaceId}: LID ${mascararLid(s.lid)} (${s.mensagens} mensagem(ns))`)
  if (rel.semProva.length > LIMITE) print(`  ... e mais ${rel.semProva.length - LIMITE}`)
  print('  Esses se unificam sozinhos quando o cliente escrever de novo e a Evolution entregar o LID com o telefone.')
}

export async function main(argv: string[], print: (s: string) => void = console.log): Promise<number> {
  const apply = argv.includes('--apply')
  const wi = argv.indexOf('--workspace')
  const workspaceId = wi >= 0 ? argv[wi + 1] : undefined
  if (wi >= 0 && !workspaceId) {
    print('Uso: npx tsx scripts/unificar-contatos.ts [--dry-run | --apply] [--workspace <id>]')
    return 2
  }
  const rel = await levantar({ workspaceId })
  print(apply ? 'Modo: --apply (unifica os pares com prova)' : 'Modo: --dry-run (nada é alterado; use --apply para unificar)')
  print('')
  imprimir(rel, print)
  if (!apply || !rel.pares.length) return 0
  print('')
  const res = await aplicar(rel.pares)
  for (const { par, r, erro } of res) {
    if (erro) print(`  FALHOU ${par.dupId} -> ${par.keepId} (${erro}); nada foi alterado neste par`)
    else if (!r) print(`  pulado ${par.dupId} -> ${par.keepId} (já unificado ou a prova não vale mais)`)
    else print(`  unificado ${r.dupId} -> ${r.keepId}: ${r.mensagensMovidas} mensagem(ns) movida(s), ${r.mensagensDescartadas} repetida(s) descartada(s)`)
  }
  return res.some((x) => x.erro) ? 1 : 0
}

if (process.argv[1] && /unificar-contatos\.ts$/.test(process.argv[1])) {
  loadEnvConfig(process.cwd())
  main(process.argv.slice(2))
    .then(async (code) => {
      await db.$disconnect()
      process.exit(code)
    })
    .catch(async (e) => {
      console.error(`Falhou: ${e instanceof Error ? e.message.slice(0, 300) : 'erro'}`)
      await db.$disconnect().catch(() => {})
      process.exit(1)
    })
}
