'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import type {
  AgentDTO,
  BillingDTO,
  CampaignDTO,
  CampaignListDTO,
  DisparosSettingsDTO,
  DrawerKey,
  FollowUpDTO,
  FollowUpQueueItemDTO,
  KnowledgeItemDTO,
  SettingsDTO,
  TemplateDTO,
} from '@/lib/types'
import { api } from './api'
import {
  AGENTE_INICIAL,
  DISP_INICIAL,
  FU_INICIAL,
  FU_PARAR_INICIAL,
  HANDOFF_INICIAL,
  HORARIO_ATENDIMENTO_PADRAO,
  NOTIF_INICIAL,
  TPL_PADRAO,
} from './mock-data'
import type { Campanha, DispState, Horario, Idioma, KbItem, PlanoNome, Template, Tom } from './mock-data'
import { defaultDispData, toCampanha } from './view'

type Agente = { nome: string; tom: Tom; horario: Horario; prompt: string; canSchedule: boolean; idioma: Idioma; ritmoNatural: boolean; confirmarAgendamento: boolean }
type Fu = { espera: string; tentativas: string; msgs: string[] }

const CAT: Record<TemplateDTO['category'], Template['cat']> = { MARKETING: 'Marketing', UTILIDADE: 'Utilidade' }
const TPL_STATUS: Record<TemplateDTO['status'], Template['status']> = { APROVADO: 'Aprovado', EM_ANALISE: 'Em análise', REJEITADO: 'Rejeitado', PAUSADO: 'Pausado', DESATIVADO: 'Desativado' }

/** Modelo que um disparo consegue usar: aprovado na Meta, preenchível ({{1}} no máx.) e sem recursos que o PearChat não envia. */
export const templateUsable = (t: Template): boolean => t.status === 'Aprovado' && !t.soLocal && !t.naoSuportado && (t.vars ?? 0) <= 1

export const toTemplate = (t: TemplateDTO): Template => ({
  id: t.id,
  nome: t.name,
  cat: CAT[t.category],
  status: TPL_STATUS[t.status],
  corpo: t.body,
  motivo: t.rejectionReason ?? null,
  soLocal: t.onlyLocal ?? false,
  vars: t.vars ?? 0,
  exemplos: t.examples ?? [],
  naoSuportado: t.unsupported ?? null,
})
export const toKbItem = (k: KnowledgeItemDTO): KbItem => ({ id: k.id, p: k.pergunta, r: k.resposta })

// Estado dos formulários dos drawers. Vive acima do DrawerHost porque a sidebar lê daqui (campanhas, plano).
// Cada drawer recarrega os seus dados do servidor ao abrir (useDrawerLoad); "Salvar" grava de verdade.
export type DrawerData = {
  agente: Agente
  setAgente: Dispatch<SetStateAction<Agente>>
  kb: KbItem[]
  setKb: Dispatch<SetStateAction<KbItem[]>>
  handoff: string[]
  setHandoff: Dispatch<SetStateAction<string[]>>
  disp: DispState
  setDisp: Dispatch<SetStateAction<DispState>>
  listas: CampaignListDTO[]
  campanhas: Campanha[]
  setCampanhas: Dispatch<SetStateAction<Campanha[]>>
  templates: Template[]
  setTemplates: Dispatch<SetStateAction<Template[]>>
  tplSel: string
  setTplSel: Dispatch<SetStateAction<string>>
  fu: Fu
  setFu: Dispatch<SetStateAction<Fu>>
  fuParar: string[]
  setFuParar: Dispatch<SetStateAction<string[]>>
  fuFila: FollowUpQueueItemDTO[]
  silencio: DisparosSettingsDTO
  setSilencio: Dispatch<SetStateAction<DisparosSettingsDTO>>
  horarioAtendimento: string
  setHorarioAtendimento: Dispatch<SetStateAction<string>>
  notifs: string[]
  setNotifs: Dispatch<SetStateAction<string[]>>
  plano: PlanoNome
  setPlano: Dispatch<SetStateAction<PlanoNome>>
  billing: BillingDTO | null
  contatosCount: number
  /** Carrega do servidor os dados do drawer. Nunca rejeita: em caso de erro mostra um toast. */
  loadDrawer: (key: DrawerKey) => Promise<void>
  /** Toast de erro padrão (Warning). */
  failToast: (title: string, e: unknown) => void
}

const Ctx = createContext<DrawerData | null>(null)

const FU_ESPERA = (h: number) => `${h} h`

export function DrawerDataProvider({
  initial,
  children,
}: {
  initial: { plano: PlanoNome; horarioAtendimento: string | null; contatosCount: number; campanhas: CampaignDTO[] }
  children: ReactNode
}) {
  const { toast, setAgentName, setUser, setFuQueueCount } = useAppState()
  const [agente, setAgente] = useState<Agente>(AGENTE_INICIAL)
  const [kb, setKb] = useState<KbItem[]>([])
  const [handoff, setHandoff] = useState(HANDOFF_INICIAL)
  const [disp, setDisp] = useState<DispState>(() => ({ ...DISP_INICIAL, data: defaultDispData() }))
  const [listas, setListas] = useState<CampaignListDTO[]>([])
  const [campanhas, setCampanhas] = useState<Campanha[]>(() => initial.campanhas.map(toCampanha))
  const [templates, setTemplates] = useState<Template[]>([])
  const [tplSel, setTplSel] = useState('')
  const [fu, setFu] = useState<Fu>(FU_INICIAL)
  const [fuParar, setFuParar] = useState(FU_PARAR_INICIAL)
  const [fuFila, setFuFila] = useState<FollowUpQueueItemDTO[]>([])
  const [silencio, setSilencio] = useState<DisparosSettingsDTO>({ silencioAtivo: true, silencioInicio: 21, silencioFim: 8 })
  const [horarioAtendimento, setHorarioAtendimento] = useState(initial.horarioAtendimento ?? HORARIO_ATENDIMENTO_PADRAO)
  const [notifs, setNotifs] = useState(NOTIF_INICIAL)
  const [plano, setPlano] = useState<PlanoNome>(initial.plano)
  const [billing, setBilling] = useState<BillingDTO | null>(null)

  const failToast = useCallback(
    (title: string, e: unknown) => {
      toast({ icon: <Warning size={18} weight="fill" />, title, text: e instanceof Error ? e.message : 'Tente novamente em instantes.' })
    },
    [toast],
  )

  const loadDrawer = useCallback(
    async (key: DrawerKey) => {
      try {
        if (key === 'ia') {
          const [a, k] = await Promise.all([api<AgentDTO>('/api/agent'), api<KnowledgeItemDTO[]>('/api/agent/knowledge')])
          setAgente({ nome: a.nome, tom: a.tom, horario: a.horario, prompt: a.prompt, canSchedule: a.canSchedule, idioma: a.idioma, ritmoNatural: a.ritmoNatural, confirmarAgendamento: a.confirmarAgendamento })
          setAgentName(a.nome)
          setHandoff(a.handoffRules)
          setKb(k.map(toKbItem))
        } else if (key === 'followup') {
          const [f, q] = await Promise.all([api<FollowUpDTO>('/api/followup'), api<FollowUpQueueItemDTO[]>('/api/followup/queue')])
          setFu({ espera: FU_ESPERA(f.esperaHoras), tentativas: String(f.tentativas), msgs: f.mensagens })
          setFuParar(f.stopConditions)
          setFuFila(q)
          setFuQueueCount(q.length)
        } else if (key === 'disparos') {
          const [l, c, t, sil] = await Promise.all([
            api<CampaignListDTO[]>('/api/campaigns/lists'),
            api<CampaignDTO[]>('/api/campaigns'),
            api<TemplateDTO[]>('/api/templates'),
            api<DisparosSettingsDTO>('/api/campaigns/settings'),
          ])
          setSilencio(sil)
          const tpls = t.map(toTemplate)
          setListas(l)
          setCampanhas(c.map(toCampanha))
          setTemplates(tpls)
          // Mantém a seleção se ainda for um modelo aprovado; senão o padrão da spec ou o primeiro aprovado.
          setTplSel((cur) => {
            const aprovados = tpls.filter(templateUsable)
            return aprovados.find((x) => x.id === cur)?.id ?? aprovados.find((x) => x.nome === TPL_PADRAO)?.id ?? aprovados[0]?.id ?? ''
          })
        } else if (key === 'config') {
          const s = await api<SettingsDTO>('/api/settings')
          setUser({ nome: s.nome, email: s.email, empresa: s.empresa })
          setHorarioAtendimento(s.horarioAtendimento)
          setNotifs(s.notifs)
        } else {
          const b = await api<BillingDTO>('/api/billing')
          setBilling(b)
          setPlano(b.plano)
        }
      } catch (e) {
        failToast('Não foi possível carregar', e)
      }
    },
    [setAgentName, setUser, setFuQueueCount, failToast],
  )

  const value = useMemo<DrawerData>(
    () => ({
      agente, setAgente, kb, setKb, handoff, setHandoff, disp, setDisp, listas, campanhas, setCampanhas,
      templates, setTemplates, tplSel, setTplSel, fu, setFu, fuParar, setFuParar, fuFila, silencio, setSilencio,
      horarioAtendimento, setHorarioAtendimento, notifs, setNotifs, plano, setPlano, billing,
      contatosCount: initial.contatosCount,
      loadDrawer,
      failToast,
    }),
    [agente, kb, handoff, disp, listas, campanhas, templates, tplSel, fu, fuParar, fuFila, silencio, horarioAtendimento, notifs, plano, billing, initial.contatosCount, loadDrawer, failToast],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDrawerData(): DrawerData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDrawerData fora do DrawerDataProvider')
  return v
}

/** Carrega os dados do drawer ao montar. Devolve true enquanto carrega (mostre o esqueleto). */
export function useDrawerLoad(key: DrawerKey): boolean {
  const { loadDrawer } = useDrawerData()
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void loadDrawer(key).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [key, loadDrawer])
  return loading
}
