import { z } from 'zod'
import type { Campaign, Template } from '@prisma/client'
import { db } from '@/lib/db'
import type { CampaignDTO, CampaignInterval, DisparosSettingsDTO, CampaignListId, CampaignStatusKind, TemplateDTO } from '@/lib/types'
import { automationAllowed } from '@/server/billing/entitlements'
import { silenceEnd } from '@/server/engine/util'
import { countTemplateVars, templateUnsupportedReason } from '@/server/whatsapp/template-rules'
import { listName, resolveRecipientIds } from './recipients'

export class CampaignError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const INTERVALOS: Record<CampaignInterval, [number, number]> = { '5-10': [5, 10], '15-30': [15, 30], '30-60': [30, 60] }
/** Status que ainda não terminaram: o liga/desliga de Disparos pausa os que estão em andamento. */
const EM_ANDAMENTO: CampaignStatusKind[] = ['na_fila', 'enviando']
const NAO_FINAIS: CampaignStatusKind[] = ['agendada', 'na_fila', 'enviando']

// ---- Modelos (templates) ----

export const templateSchema = z.object({
  // snake_case: minúsculas, números e "_". Se omitido, o servidor gera novo_modelo_N.
  name: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,59}$/, 'Use snake_case: letras minúsculas, números e _ (mínimo 3 caracteres)')
    .optional(),
  category: z.enum(['MARKETING', 'UTILIDADE']).default('MARKETING'),
  body: z.string().trim().min(1, 'Escreva o texto do modelo').max(1024).refine((s) => !s.includes('\u0000'), 'Texto inválido'), // {{1}} é permitido
  /** Modelo local já existente ("Só no PearChat") a enviar para a Meta. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /** Exemplo de preenchimento de cada variável (obrigatório na Meta quando o corpo tem {{n}}). */
  examples: z.array(z.string().max(200)).max(10).default([]),
})

export const toTemplateDTO = (t: Template): TemplateDTO => ({
  id: t.id,
  name: t.name,
  category: t.category,
  status: t.status,
  body: t.body,
  language: t.language,
  rejectionReason: t.rejectionReason,
  onlyLocal: !t.metaId,
  vars: countTemplateVars(t.body),
  examples: t.exampleValues,
  unsupported: templateUnsupportedReason(t.components),
})

export async function listTemplates(workspaceId: string): Promise<TemplateDTO[]> {
  const rows = await db.template.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } })
  return rows.map(toTemplateDTO)
}

/** Cria um modelo "Em análise" (nunca vira aprovado sozinho: a aprovação vem da Meta). */
export async function createTemplate(workspaceId: string, input: z.infer<typeof templateSchema>): Promise<TemplateDTO> {
  let name = input.name
  if (!name) {
    const total = await db.template.count({ where: { workspaceId } })
    for (let n = total + 1; ; n++) {
      const candidate = `novo_modelo_${n}`
      if (!(await db.template.findUnique({ where: { workspaceId_name: { workspaceId, name: candidate } }, select: { id: true } }))) {
        name = candidate
        break
      }
    }
  } else if (await db.template.findUnique({ where: { workspaceId_name: { workspaceId, name } }, select: { id: true } })) {
    throw new CampaignError('Já existe um modelo com esse nome', 409)
  }
  const t = await db.template.create({
    data: { workspaceId, name, category: input.category, status: 'EM_ANALISE', body: input.body },
  })
  return toTemplateDTO(t)
}

// ---- Campanhas ----

/** Ids (cuid) só têm letras, números, _ e -: qualquer outra coisa nem vai ao banco (NUL daria erro 500). */
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/

// O nome da lista "Aniversariantes de <mês>" usa o mês da criação no fuso padrão (é só um rótulo; a seleção dos
// destinatários, feita na criação, usa o fuso do espaço).
const toCampaignDTO = (c: Campaign): CampaignDTO => ({
  id: c.id,
  lista: c.lista,
  listaNome: listName(c.lista, c.createdAt),
  mensagem: c.mensagem,
  templateId: c.templateId,
  status: c.status as CampaignStatusKind,
  total: c.total,
  enviadas: c.enviadas,
  respostas: c.respostas,
  intervalo: (c.intervaloFaixa as CampaignInterval | null) ?? null,
  scheduledAt: c.scheduledAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
})

export async function listCampaigns(workspaceId: string): Promise<CampaignDTO[]> {
  const [rows, ws] = await Promise.all([
    db.campaign.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { disparosSilencioAtivo: true, disparosSilencioInicio: true, disparosSilencioFim: true, timezone: true } }),
  ])
  const now = new Date()
  // Em andamento (ou agendada que já chegou na hora) e dentro do horário de silêncio: "Aguardando horário permitido".
  const retida = !!ws && !!silenceEnd(now, ws)
  return rows.map((c) => {
    const dto = toCampaignDTO(c)
    const ativa = c.status === 'na_fila' || c.status === 'enviando' || (c.status === 'agendada' && !!c.scheduledAt && c.scheduledAt <= now)
    return retida && ativa ? { ...dto, aguardandoHorario: true } : dto
  })
}

// ---- Horário de silêncio dos disparos ----

export const disparosSettingsSchema = z
  .object({
    silencioAtivo: z.boolean(),
    silencioInicio: z.number().int().min(0).max(23),
    silencioFim: z.number().int().min(0).max(23),
  })
  .strict()
  .refine((v) => v.silencioInicio !== v.silencioFim, { message: 'Início e fim do silêncio devem ser horas diferentes' })

export async function getDisparosSettings(workspaceId: string): Promise<DisparosSettingsDTO> {
  const ws = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { disparosSilencioAtivo: true, disparosSilencioInicio: true, disparosSilencioFim: true },
  })
  return { silencioAtivo: ws.disparosSilencioAtivo, silencioInicio: ws.disparosSilencioInicio, silencioFim: ws.disparosSilencioFim }
}

export async function updateDisparosSettings(workspaceId: string, input: z.infer<typeof disparosSettingsSchema>): Promise<DisparosSettingsDTO> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { disparosSilencioAtivo: input.silencioAtivo, disparosSilencioInicio: input.silencioInicio, disparosSilencioFim: input.silencioFim },
  })
  // Campanhas retidas pelo silêncio antigo (próximo envio exatamente numa hora cheia, no futuro) são liberadas
  // para o motor reavaliar com a nova janela já no próximo ciclo. Esperas de intervalo (aleatórias) não são tocadas.
  const now = Date.now()
  const held = await db.campaign.findMany({
    where: { workspaceId, status: { in: ['na_fila', 'enviando', 'agendada'] }, nextSendAt: { gt: new Date(now) } },
    select: { id: true, nextSendAt: true },
  })
  const ids = held.filter((c) => c.nextSendAt && c.nextSendAt.getTime() % 3_600_000 === 0).map((c) => c.id)
  if (ids.length > 0) await db.campaign.updateMany({ where: { id: { in: ids } }, data: { nextSendAt: null } })
  return getDisparosSettings(workspaceId)
}

export const campaignSchema = z
  .object({
    lista: z.enum(['todos', 'clientes', 'aniv', 'frios']),
    mensagem: z.string().max(1024).refine((s) => !s.includes('\u0000'), 'Texto inválido').optional(),
    templateId: z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/, 'Modelo inválido').optional(),
    quando: z.enum(['agora', 'agendar']),
    data: z.string().max(40).optional(), // ISO 8601 (com fuso)
    intervalo: z.enum(['5-10', '15-30', '30-60']),
  })
  .strict()
export type CampaignInput = z.infer<typeof campaignSchema>

export type CreateCampaignResult = {
  campaign: CampaignDTO
  /**
   * Nenhum envio acontece aqui. O worker de disparos (próxima etapa) deve consumir CampaignRecipient com
   * status "pendente" das campanhas "na_fila"/"agendada" (scheduledAt <= agora), com Workspace.disparosAtivos
   * ligado, respeitando intervaloMin/Max e revalidando optOut.
   */
  enviado: false
}

/** Valida e cria a campanha com os destinatários reais. NÃO envia nada. */
export async function createCampaign(workspaceId: string, input: CampaignInput): Promise<CreateCampaignResult> {
  if (!(await automationAllowed(workspaceId))) throw new CampaignError('Sua assinatura está inativa. Regularize em Plano e pagamento para enviar disparos.', 403)
  const wa = await db.whatsAppSession.findUnique({ where: { workspaceId }, select: { status: true, provider: true } })
  if (wa?.status !== 'CONECTADO') throw new CampaignError('Conecte o WhatsApp primeiro', 409)

  let mensagem: string
  let templateId: string | null = null
  if (wa.provider === 'OFICIAL') {
    if (!input.templateId) throw new CampaignError('Escolha um modelo aprovado', 400)
    const tpl = await db.template.findFirst({ where: { id: input.templateId, workspaceId } })
    if (!tpl) throw new CampaignError('Modelo não encontrado', 404)
    if (tpl.status !== 'APROVADO') throw new CampaignError('Aguarde a aprovação da Meta para usar este modelo', 409)
    if (!tpl.metaId) throw new CampaignError('Este modelo existe só no PearChat: envie-o para aprovação da Meta antes de usar', 409)
    const unsupported = templateUnsupportedReason(tpl.components)
    if (unsupported) throw new CampaignError(unsupported, 422)
    // O disparo só preenche {{1}} (primeiro nome): modelo com mais variáveis seria recusado pela Meta em cada envio.
    const maxVar = Math.max(0, ...Array.from(tpl.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
    if (maxVar > 1) throw new CampaignError('Este modelo usa variáveis além de {{1}}; disparos só preenchem o primeiro nome', 422)
    mensagem = tpl.body
    templateId = tpl.id
  } else {
    mensagem = (input.mensagem ?? '').trim()
    if (!mensagem) throw new CampaignError('Escreva a mensagem', 400)
  }

  let scheduledAt: Date | null = null
  if (input.quando === 'agendar') {
    scheduledAt = input.data ? new Date(input.data) : null
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) throw new CampaignError('Data e hora inválidas', 400)
    if (scheduledAt.getTime() < Date.now() - 60_000) throw new CampaignError('Escolha uma data no futuro', 400)
  }

  const ids = await resolveRecipientIds(workspaceId, input.lista as CampaignListId)
  if (ids.length === 0) throw new CampaignError('Nenhum contato nesta lista', 422)

  const [min, max] = INTERVALOS[input.intervalo]
  const campaign = await db.$transaction(async (tx) => {
    const c = await tx.campaign.create({
      data: {
        workspaceId,
        lista: input.lista,
        mensagem,
        templateId,
        scheduledAt,
        intervaloMin: min,
        intervaloMax: max,
        intervaloFaixa: input.intervalo,
        status: scheduledAt ? 'agendada' : 'na_fila',
        total: ids.length,
      },
    })
    await tx.campaignRecipient.createMany({ data: ids.map((contactId) => ({ campaignId: c.id, contactId })), skipDuplicates: true })
    return c
  })
  return { campaign: toCampaignDTO(campaign), enviado: false }
}

/** Pausa uma campanha. Devolve null se não for do workspace. */
export async function pauseCampaign(workspaceId: string, id: string): Promise<CampaignDTO | null> {
  if (!ID_OK.test(id)) return null
  const c = await db.campaign.findFirst({ where: { id, workspaceId } })
  if (!c) return null
  if (!NAO_FINAIS.includes(c.status as CampaignStatusKind)) {
    if (c.status === 'pausada') return toCampaignDTO(c)
    throw new CampaignError('Esta campanha já foi concluída', 409)
  }
  return toCampaignDTO(await db.campaign.update({ where: { id }, data: { status: 'pausada', pausedAt: new Date() } }))
}

/** Retoma uma campanha pausada. Devolve null se não for do workspace. */
export async function resumeCampaign(workspaceId: string, id: string): Promise<CampaignDTO | null> {
  if (!ID_OK.test(id)) return null
  const c = await db.campaign.findFirst({ where: { id, workspaceId } })
  if (!c) return null
  if (c.status !== 'pausada') {
    if (NAO_FINAIS.includes(c.status as CampaignStatusKind)) return toCampaignDTO(c)
    throw new CampaignError('Esta campanha já foi concluída', 409)
  }
  const futura = c.scheduledAt && c.scheduledAt.getTime() > Date.now()
  const status: CampaignStatusKind = futura ? 'agendada' : c.enviadas > 0 ? 'enviando' : 'na_fila'
  return toCampaignDTO(await db.campaign.update({ where: { id }, data: { status, pausedAt: null } }))
}

/** Liga/desliga Disparos. Desligar pausa as campanhas em andamento (agendadas continuam agendadas; o worker só envia com o flag ligado). */
export async function setDisparosAtivos(workspaceId: string, on: boolean): Promise<void> {
  await db.workspace.update({ where: { id: workspaceId }, data: { disparosAtivos: on } })
  if (!on) {
    await db.campaign.updateMany({
      where: { workspaceId, status: { in: EM_ANDAMENTO } },
      data: { status: 'pausada', pausedAt: new Date() },
    })
  }
}
