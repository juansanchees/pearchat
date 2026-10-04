import { db } from '@/lib/db'
import { getConnected, log, logError } from '@/server/engine/util'
import { checkAvatarBytes, AVATAR_MAX_BYTES, contactPhotoIdFromUrl, contactPhotoUrl, deleteContactPhoto, putContactPhoto } from '@/server/media/avatars'
import type { AvatarMarker } from '@/server/media/avatars'
import { loadConversationItem } from '@/server/messages/dto'
import { emitToWorkspace } from '@/server/realtime/emit'
import { getProvider, isMock } from '@/server/whatsapp'

// Foto de perfil do WhatsApp dos contatos. A URL do provedor expira e NUNCA vai ao navegador: o servidor baixa a imagem,
// valida, guarda no disco (`contact-photos/<espaço>/…`, mesmo mecanismo das fotos de perfil) e a tela a lê pela rota
// autenticada /api/contact-photo/<id>. Tudo em segundo plano e de forma preguiçosa: nada disto está no caminho da mensagem.

const DAY = 86_400_000
/** Revalida no máximo a cada 7 dias (é o que impede buscar duas vezes dentro desse prazo). */
export const PHOTO_RECHECK_MS = 7 * DAY
/** Falha do provedor ou do download: tenta de novo em ~6 h (grava um "verificado em" mais antigo). */
const FAIL_RETRY_MS = 6 * 3_600_000
const DOWNLOAD_TIMEOUT_MS = 8_000
/** Espaço entre duas chamadas ao Evolution (não sobrecarrega nem arrisca o número). */
const spacingMs = () => Math.max(0, Number(process.env.PHOTO_SPACING_MS ?? 3_000) || 0)
/** Passada do agendador: no máximo PHOTO_BATCH contatos a cada PHOTO_TICK_MS = 3 a cada 15 s = 12 por minuto. */
export const PHOTO_TICK_MS = 15_000
export const PHOTO_BATCH = 3
const RECENT_CONVERSATION_MS = 30 * DAY
const QUEUE_MAX = 100

/** Hosts de teste (host:porta, separados por vírgula): SÓ valem com WA_MOCK=true, nunca em produção real. */
function testHosts(): string[] {
  if (!isMock()) return []
  return (process.env.CONTACT_PHOTO_TEST_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
}

/**
 * Anti-SSRF: só `https` e só os hosts de mídia do WhatsApp (`pps.whatsapp.net` e qualquer `*.whatsapp.net`), porta padrão,
 * sem usuário/senha na URL. Qualquer outra coisa (IP, localhost, outro domínio, http) é recusada.
 */
export function allowedPhotoUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  if (u.protocol === 'https:' && (host === 'whatsapp.net' || host.endsWith('.whatsapp.net')) && (u.port === '' || u.port === '443')) return u
  if ((u.protocol === 'http:' || u.protocol === 'https:') && testHosts().includes(u.host.toLowerCase())) return u
  return null
}

/** Baixa a imagem (sem seguir redirecionamento, com limite de tempo e de tamanho) e confere pelos bytes: JPEG, PNG ou WebP. */
export async function downloadPhoto(raw: string): Promise<{ data: Buffer; marker: AvatarMarker } | null> {
  const url = allowedPhotoUrl(raw)
  if (!url) return null
  let res: Response
  try {
    res = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), headers: { accept: 'image/jpeg,image/png,image/webp' } })
  } catch {
    return null
  }
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => {})
    return null // inclui 3xx: nunca segue para outro host
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
    await res.body.cancel().catch(() => {})
    return null
  }
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(Buffer.from(value))
    }
  } catch {
    return null
  }
  const data = Buffer.concat(chunks)
  const check = checkAvatarBytes(data.subarray(0, 4096))
  return check.ok ? { data, marker: check.marker } : null
}

export type PhotoResult = 'atualizada' | 'sem_foto' | 'recente' | 'sem_contato' | 'sem_telefone' | 'desconectado' | 'sem_suporte' | 'falha'

async function announce(workspaceId: string, contactId: string): Promise<void> {
  const conv = await db.conversation.findFirst({ where: { contactId, workspaceId }, select: { id: true } })
  if (!conv) return
  const item = await loadConversationItem(workspaceId, conv.id)
  if (item) emitToWorkspace(workspaceId, 'conversation.updated', { workspaceId, conversation: item })
}

/**
 * Busca (se preciso) a foto do contato. Idempotente e segura contra concorrência: a "reivindicação" é um UPDATE condicional
 * em `photoCheckedAt`, então duas chamadas (ou duas instâncias) juntas fazem UMA consulta ao provedor, e nada é buscado
 * duas vezes dentro de 7 dias. Nunca lança.
 */
export async function refreshContactPhoto(workspaceId: string, contactId: string): Promise<PhotoResult> {
  try {
    const now = new Date()
    const cutoff = new Date(now.getTime() - PHOTO_RECHECK_MS)
    const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId }, select: { telefone: true, waUserId: true, photoUrl: true, photoCheckedAt: true } })
    if (!contact) return 'sem_contato'
    if (contact.photoCheckedAt && contact.photoCheckedAt > cutoff) return 'recente'
    // Grupos nunca viram contato; contato sem telefone (só BSUID) não tem como consultar: marca e segue.
    if (!contact.telefone || (contact.waUserId ?? '').endsWith('@g.us')) {
      await db.contact.updateMany({ where: { id: contactId, workspaceId }, data: { photoCheckedAt: now } })
      return 'sem_telefone'
    }
    const session = await getConnected(workspaceId)
    if (!session) return 'desconectado'
    const provider = getProvider(session.kind)
    if (!provider.fetchProfilePicture) return 'sem_suporte'

    const claim = await db.contact.updateMany({
      where: { id: contactId, workspaceId, OR: [{ photoCheckedAt: null }, { photoCheckedAt: { lte: cutoff } }] },
      data: { photoCheckedAt: now },
    })
    if (claim.count !== 1) return 'recente'

    const failed = async (): Promise<PhotoResult> => {
      await db.contact.updateMany({ where: { id: contactId, workspaceId }, data: { photoCheckedAt: new Date(now.getTime() - PHOTO_RECHECK_MS + FAIL_RETRY_MS) } })
      return 'falha'
    }
    let url: string | null
    try {
      url = await provider.fetchProfilePicture(workspaceId, { telefone: contact.telefone })
    } catch (e) {
      logError('foto', 'consulta ao provedor falhou', e)
      return failed()
    }
    const oldId = contactPhotoIdFromUrl(contact.photoUrl)
    if (!url) {
      // Sem foto (ou privada): só o "verificado em". Se ele tinha uma foto e a removeu, a nossa cópia também sai.
      if (oldId) {
        await db.contact.updateMany({ where: { id: contactId, workspaceId }, data: { photoUrl: null } })
        await deleteContactPhoto(workspaceId, oldId)
        await announce(workspaceId, contactId)
      }
      return 'sem_foto'
    }
    const img = await downloadPhoto(url)
    if (!img) {
      log('foto', `imagem recusada ou indisponível (contato ${contactId})`)
      return failed()
    }
    const id = await putContactPhoto(workspaceId, img.data, img.marker)
    await db.contact.updateMany({ where: { id: contactId, workspaceId }, data: { photoUrl: contactPhotoUrl(id) } })
    if (oldId) await deleteContactPhoto(workspaceId, oldId)
    await announce(workspaceId, contactId)
    return 'atualizada'
  } catch (e) {
    logError('foto', 'falha ao atualizar a foto', e)
    return 'falha'
  }
}

// ---- Fila em segundo plano (uma consulta por vez, com intervalo) ----

type Q = { items: { workspaceId: string; contactId: string }[]; queued: Set<string>; draining: boolean }
const holder = globalThis as unknown as { __pearchat_photo_q?: Q; __pearchat_photo_last?: number }
const q = (holder.__pearchat_photo_q ??= { items: [], queued: new Set(), draining: false })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function drain(): Promise<void> {
  if (q.draining) return
  q.draining = true
  try {
    for (let it = q.items.shift(); it; it = q.items.shift()) {
      const r = await refreshContactPhoto(it.workspaceId, it.contactId)
      q.queued.delete(it.contactId)
      if (r === 'atualizada' || r === 'sem_foto' || r === 'falha') await sleep(spacingMs())
    }
  } finally {
    q.draining = false
  }
}

/** Põe o contato na fila de busca de foto (sem esperar; a fila tem teto e não repete o mesmo contato). */
export function queuePhotoRefresh(workspaceId: string, contactId: string): void {
  if (q.queued.has(contactId) || q.items.length >= QUEUE_MAX) return
  q.queued.add(contactId)
  q.items.push({ workspaceId, contactId })
  void drain()
}

/** Chegou mensagem de um contato sem foto verificada nos últimos 7 dias: enfileira (não bloqueia a mensagem). */
export function maybeQueuePhoto(workspaceId: string, contact: { id: string; telefone: string | null; photoCheckedAt: Date | null }): void {
  if (!contact.telefone) return
  if (contact.photoCheckedAt && Date.now() - contact.photoCheckedAt.getTime() < PHOTO_RECHECK_MS) return
  queuePhotoRefresh(workspaceId, contact.id)
}

/**
 * Tarefa do agendador: percorre aos poucos os contatos com conversa dos últimos 30 dias que nunca foram verificados (ou
 * cuja verificação passou de 7 dias), só em espaços com WhatsApp conectado por Evolution. No máximo 3 contatos a cada 15 s
 * (12 por minuto), e a fila ainda espaça as chamadas. Devolve quantos enfileirou.
 */
export async function runDuePhotoRefresh(): Promise<number> {
  const nowMs = Date.now()
  if (nowMs - (holder.__pearchat_photo_last ?? 0) < PHOTO_TICK_MS) return 0
  holder.__pearchat_photo_last = nowMs
  const rows = await db.contact.findMany({
    where: {
      telefone: { not: null },
      OR: [{ photoCheckedAt: null }, { photoCheckedAt: { lte: new Date(nowMs - PHOTO_RECHECK_MS) } }],
      conversation: { is: { lastMessageAt: { gte: new Date(nowMs - RECENT_CONVERSATION_MS) } } },
      workspace: { arquivadoEm: null, whatsappSession: { is: { status: 'CONECTADO', provider: 'RAPIDA' } } },
    },
    orderBy: [{ photoCheckedAt: { sort: 'asc', nulls: 'first' } }, { conversation: { lastMessageAt: 'desc' } }],
    take: PHOTO_BATCH,
    select: { id: true, workspaceId: true },
  })
  for (const r of rows) queuePhotoRefresh(r.workspaceId, r.id)
  return rows.length
}
