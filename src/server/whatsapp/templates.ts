import type { Prisma, Template } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { logError } from '@/server/engine/util'
import { graph, isGraphError } from './graph'
import { readSessionData } from './session'
import { countTemplateVars, metaStatusToLocal, slugifyTemplateName, validateTemplateDraft } from './template-rules'

// Modelos de mensagem da Cloud API: criar, sincronizar, excluir e acompanhar o status (webhook message_template_status_update).

export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'TemplateError'
  }
}

const SYNC_MIN_INTERVAL_MS = 60_000
const g = globalThis as unknown as { __pearchat_tpl_sync?: Map<string, number> }
const lastSync = (g.__pearchat_tpl_sync ??= new Map<string, number>())

type Conn = { token: string; wabaId: string }

async function connection(workspaceId: string): Promise<Conn> {
  const row = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { provider: true, status: true, metaWabaId: true } })
  if (!row || row.provider !== 'OFICIAL' || !row.metaWabaId) throw new TemplateError('Modelos da Meta só existem na conexão oficial', 409)
  const token = (await readSessionData(workspaceId)).accessToken ?? process.env.META_SYSTEM_USER_TOKEN
  if (!token) throw new TemplateError('WhatsApp oficial sem acesso à Meta. Reconecte.', 409)
  return { token, wabaId: row.metaWabaId }
}

/** Mensagem para o usuário a partir de um erro da Graph, sempre com o fbtrace_id para suporte. */
function graphMessage(e: unknown, fallback: string): string {
  if (!isGraphError(e)) return fallback
  const base = e.userMessage ?? e.details ?? e.message
  return `${base.slice(0, 200)} (código ${e.code ?? e.status}${e.fbtraceId ? `, fbtrace_id ${e.fbtraceId}` : ''})`
}

const remoteSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string(),
    status: z.string().optional(),
    category: z.string().optional(),
    language: z.string().optional(),
    components: z.array(z.unknown()).optional(),
    rejected_reason: z.string().optional(),
  })
  .passthrough()
type Remote = z.infer<typeof remoteSchema>

const localCategory = (c: string | undefined): 'MARKETING' | 'UTILIDADE' | null => {
  const v = (c ?? '').toUpperCase()
  return v === 'MARKETING' ? 'MARKETING' : v === 'UTILITY' ? 'UTILIDADE' : null
}

function bodyOf(components: unknown[] | undefined): { text: string; examples: string[] } {
  for (const c of components ?? []) {
    const o = c as { type?: string; text?: string; example?: { body_text?: unknown } }
    if (String(o.type ?? '').toUpperCase() !== 'BODY') continue
    const first = Array.isArray(o.example?.body_text) ? (o.example!.body_text as unknown[])[0] : undefined
    return { text: o.text ?? '', examples: Array.isArray(first) ? (first as unknown[]).map(String) : [] }
  }
  return { text: '', examples: [] }
}

const reasonOf = (r: string | undefined) => (r && r.toUpperCase() !== 'NONE' ? r.slice(0, 300) : null)

async function fetchRemote(c: Conn): Promise<Remote[]> {
  const out: Remote[] = []
  let after: string | undefined
  for (let page = 0; page < 10; page++) {
    const raw = await graph({
      path: `/${encodeURIComponent(c.wabaId)}/message_templates`,
      token: c.token,
      query: { fields: 'id,name,status,category,language,components,rejected_reason', limit: 100, ...(after ? { after } : {}) },
    })
    const parsed = z
      .object({ data: z.array(z.unknown()), paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional() })
      .passthrough()
      .safeParse(raw)
    if (!parsed.success) throw new TemplateError('Resposta inesperada da Meta ao listar modelos', 502)
    for (const item of parsed.data.data) {
      const r = remoteSchema.safeParse(item)
      if (r.success) out.push(r.data)
    }
    after = parsed.data.paging?.next ? parsed.data.paging.cursors?.after : undefined
    if (!after) break
  }
  return out
}

/**
 * Traz os modelos da WABA para o banco. Cria os que não existem, atualiza status/motivo/corpo e marca como
 * "Só no PearChat" (metaId vazio, em análise) os locais que a Meta não conhece. No máx. 1 vez por minuto, salvo `force`.
 */
export async function syncTemplates(workspaceId: string, opts: { force?: boolean } = {}): Promise<{ synced: number; skipped?: boolean }> {
  const now = Date.now()
  if (!opts.force && now - (lastSync.get(workspaceId) ?? 0) < SYNC_MIN_INTERVAL_MS) return { synced: 0, skipped: true }
  lastSync.set(workspaceId, now)
  const conn = await connection(workspaceId)
  let remote: Remote[]
  try {
    remote = await fetchRemote(conn)
  } catch (e) {
    lastSync.delete(workspaceId)
    if (e instanceof TemplateError) throw e
    throw new TemplateError(graphMessage(e, 'Não foi possível listar os modelos na Meta'), 502)
  }

  const local = await db.template.findMany({ where: { workspaceId } })
  const seenIds = new Set<string>()
  // Mesmo nome em vários idiomas: o PearChat guarda um só, preferindo pt_BR.
  const chosen = new Map<string, Remote>()
  for (const r of remote) {
    if (!localCategory(r.category)) continue // autenticação e outras categorias ainda não são usadas
    const cur = chosen.get(r.name)
    if (!cur || (r.language === 'pt_BR' && cur.language !== 'pt_BR')) chosen.set(r.name, r)
  }
  let synced = 0
  for (const r of Array.from(chosen.values())) {
    seenIds.add(r.id)
    const body = bodyOf(r.components)
    const data = {
      metaId: r.id,
      language: r.language || 'pt_BR',
      status: metaStatusToLocal(r.status),
      category: localCategory(r.category)!,
      body: body.text || '(sem texto)',
      components: (r.components ?? []) as Prisma.InputJsonValue,
      exampleValues: body.examples,
      rejectionReason: metaStatusToLocal(r.status) === 'APROVADO' ? null : reasonOf(r.rejected_reason),
      syncedAt: new Date(),
    }
    const existing = local.find((t) => t.metaId === r.id) ?? local.find((t) => t.name === r.name)
    if (existing) await db.template.update({ where: { id: existing.id }, data })
    else await db.template.create({ data: { workspaceId, name: r.name, ...data } })
    synced++
  }
  // Locais com metaId que sumiram da Meta (excluídos lá) e os que nunca foram enviados: "Só no PearChat", sem aprovação.
  for (const t of local) {
    const gone = t.metaId && !seenIds.has(t.metaId)
    const neverSent = !t.metaId && t.status === 'APROVADO'
    if (gone || neverSent) {
      await db.template.update({ where: { id: t.id }, data: { metaId: null, status: 'EM_ANALISE', rejectionReason: null, syncedAt: new Date() } })
    }
  }
  return { synced }
}

export type SubmitInput = {
  /** Modelo local já existente ("Só no PearChat") a enviar para aprovação. */
  id?: string
  name?: string
  category: 'MARKETING' | 'UTILIDADE'
  body: string
  examples: string[]
}

/** Cria o modelo na Meta (POST /{waba}/message_templates) e grava/atualiza o registro local com o status devolvido. */
export async function submitTemplate(workspaceId: string, input: SubmitInput): Promise<Template> {
  const conn = await connection(workspaceId)
  const existing = input.id ? await db.template.findFirst({ where: { id: input.id, workspaceId } }) : null
  if (input.id && !existing) throw new TemplateError('Modelo não encontrado', 404)
  if (existing?.metaId) throw new TemplateError('Este modelo já foi enviado para a Meta', 409)

  const name = (existing?.name ?? input.name?.trim()) || slugifyTemplateName(input.body.slice(0, 40))
  const body = input.body.trim()
  const errors = validateTemplateDraft({ name, category: input.category, body, examples: input.examples })
  if (errors.length) throw new TemplateError(errors[0]!, 422)
  if (!existing) {
    const dup = await db.template.findUnique({ where: { workspaceId_name: { workspaceId, name } }, select: { id: true } })
    if (dup) throw new TemplateError('Já existe um modelo com esse nome', 409)
  }

  const n = countTemplateVars(body)
  const component: Record<string, unknown> = { type: 'BODY', text: body }
  if (n > 0) component.example = { body_text: [input.examples.slice(0, n).map((e) => e.trim())] }

  let created: { id: string; status?: string; category?: string }
  try {
    const raw = await graph({
      method: 'POST',
      path: `/${encodeURIComponent(conn.wabaId)}/message_templates`,
      token: conn.token,
      body: { name, language: 'pt_BR', category: input.category === 'MARKETING' ? 'MARKETING' : 'UTILITY', components: [component] },
    })
    const parsed = z
      .object({ id: z.union([z.string(), z.number()]).transform(String), status: z.string().optional(), category: z.string().optional() })
      .passthrough()
      .safeParse(raw)
    if (!parsed.success) throw new TemplateError('Resposta inesperada da Meta ao criar o modelo', 502)
    created = parsed.data
  } catch (e) {
    if (e instanceof TemplateError) throw e
    logError('templates', isGraphError(e) ? e.toLog() : 'falha ao criar modelo', e)
    // 4xx de validação (nome duplicado, texto recusado...) volta como 422 com a mensagem da Meta.
    throw new TemplateError(graphMessage(e, 'Não foi possível criar o modelo na Meta'), isGraphError(e) && e.status >= 400 && e.status < 500 ? 422 : 502)
  }

  const data = {
    metaId: created.id,
    language: 'pt_BR',
    // A Meta pode recategorizar (ex.: utilidade vira marketing): vale o que ela devolveu.
    category: localCategory(created.category) ?? input.category,
    status: metaStatusToLocal(created.status ?? 'PENDING'),
    body,
    components: [component] as Prisma.InputJsonValue,
    exampleValues: input.examples.slice(0, n).map((e) => e.trim()),
    rejectionReason: null,
    syncedAt: new Date(),
  }
  if (existing) return db.template.update({ where: { id: existing.id }, data })
  return db.template.create({ data: { workspaceId, name, ...data } })
}

/** Exclui o modelo: na Meta (se existir lá) e depois no banco. */
export async function deleteTemplate(workspaceId: string, id: string): Promise<boolean> {
  const t = await db.template.findFirst({ where: { id, workspaceId } })
  if (!t) return false
  if (t.metaId) {
    const conn = await connection(workspaceId)
    try {
      await graph({ method: 'DELETE', path: `/${encodeURIComponent(conn.wabaId)}/message_templates`, token: conn.token, query: { name: t.name, hsm_id: t.metaId } })
    } catch (e) {
      // 404/"não existe": já foi apagado lá. Outros erros impedem a exclusão local para não esconder um modelo vivo.
      const gone = isGraphError(e) && (e.status === 404 || e.code === 100 || e.code === 2593002)
      if (!gone) throw new TemplateError(graphMessage(e, 'Não foi possível excluir o modelo na Meta'), 502)
    }
  }
  await db.template.delete({ where: { id: t.id } })
  return true
}

/** Webhook message_template_status_update: atualiza o status/motivo em todos os workspaces que usam a WABA. */
export async function applyTemplateStatusEvent(
  wabaId: string,
  ev: { event?: string; id?: string; name?: string; language?: string; reason?: string },
): Promise<number> {
  const sessions = await db.whatsAppSession.findMany({ where: { metaWabaId: wabaId, provider: 'OFICIAL' }, select: { workspaceId: true } })
  let n = 0
  for (const s of sessions) {
    const tpl = await db.template.findFirst({
      where: { workspaceId: s.workspaceId, OR: [...(ev.id ? [{ metaId: ev.id }] : []), ...(ev.name ? [{ name: ev.name }] : [])] },
    })
    if (!tpl) {
      // Modelo criado direto no painel da Meta: busca na lista.
      void syncTemplates(s.workspaceId, { force: true }).catch((e) => logError('templates', 'sincronização por webhook falhou', e))
      continue
    }
    const status = metaStatusToLocal(ev.event)
    await db.template.update({
      where: { id: tpl.id },
      data: {
        status,
        ...(ev.id ? { metaId: ev.id } : {}),
        rejectionReason: status === 'APROVADO' ? null : reasonOf(ev.reason) ?? tpl.rejectionReason,
        syncedAt: new Date(),
      },
    })
    n++
  }
  return n
}
