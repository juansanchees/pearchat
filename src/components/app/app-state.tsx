'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarCheck, ClockClockwise, Hand, LockSimple, PaperPlaneTilt, PauseCircle, Plugs, Sparkle, Warning } from '@phosphor-icons/react'
import type { AutomationKey, DrawerKey, WhatsAppStatusDTO } from '@/lib/types'
import type { SpaceDTO, SpacesResponse } from '@/server/spaces/service'
import type { ConnectConfig } from '@/server/whatsapp/config'
import type { SpaceAttentionPayload } from '@/server/realtime/events'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { closeSocket, useRawSocketEvent, useSocketEvent } from '@/lib/socket-client'
import { toSp } from '@/components/agenda/time'
import { AUTOMATION_TITLES } from './automations'
import { emitAgendaChanged } from './events'
import { HANDOFF_WINDOW_EVENT } from './handoff'
import type { HandoffRequestedPayload } from './handoff'

export type ToastInput = {
  icon?: ReactNode
  title: string
  text?: string
  /** Botão opcional (ex.: "Ir para esse WhatsApp"); o toast com ação fica mais tempo na tela. */
  action?: { label: string; onClick: () => void }
}
// empresa = nome do negócio do WhatsApp (espaço) ativo; organizacao = nome da conta (mostrado no rodapé do menu).
export type AppUser = { nome: string; email: string; empresa: string; organizacao: string; fotoUrl: string | null }
export type ToastItem = ToastInput & { id: number }

export type AppState = {
  wa: WhatsAppStatusDTO
  setWa: (next: WhatsAppStatusDTO) => void
  connected: boolean
  automations: Record<AutomationKey, boolean>
  setAutomation: (key: AutomationKey, on: boolean) => Promise<void>
  drawer: DrawerKey | null
  openDrawer: (key: DrawerKey) => void
  closeDrawer: () => void
  toast: (t: ToastInput) => void
  user: AppUser
  agentName: string
  // Extras usados pelo shell (B e C podem ignorar)
  currentToast: ToastItem | null
  setUser: (patch: Partial<AppUser>) => void
  setAgentName: (nome: string) => void
  /** Contatos na fila de retomada do follow-up (jobs pendentes). */
  fuQueueCount: number
  setFuQueueCount: (n: number) => void
  /** WhatsApps (espaços) da organização. */
  spaces: SpacesResponse
  /** Id do espaço ativo desta tela (fixo até a página recarregar). */
  workspaceId: string
  /** Demo ligado? Meta configurada? (calculado no servidor a cada requisição). */
  connectCfg: ConnectConfig
  /** Recarrega a lista de espaços do servidor. Se o espaço ativo mudou em outra aba, recarrega a página. */
  refreshSpaces: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)
const TOAST_MS = 3800
const TOAST_ACTION_MS = 9000

export function AppStateProvider({
  initial,
  children,
}: {
  initial: {
    wa: WhatsAppStatusDTO
    automations: Record<AutomationKey, boolean>
    user: AppUser
    agentName: string
    fuQueueCount: number
    spaces: SpacesResponse
    workspaceId: string
    connectCfg: ConnectConfig
  }
  children: ReactNode
}) {
  const [wa, setWaState] = useState(initial.wa)
  const [automations, setAutomations] = useState(initial.automations)
  const [drawer, setDrawer] = useState<DrawerKey | null>(null)
  const [currentToast, setCurrentToast] = useState<ToastItem | null>(null)
  const [user, setUserState] = useState(initial.user)
  const [agentName, setAgentName] = useState(initial.agentName)
  const [fuQueueCount, setFuQueueCount] = useState(initial.fuQueueCount)
  const [spaces, setSpaces] = useState(initial.spaces)
  const workspaceId = initial.workspaceId
  const connectCfg = initial.connectCfg
  const seq = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const connected = wa.status === 'conectado'

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Ao sair do app (logout/desmontagem) a conexão em tempo real é encerrada.
  useEffect(() => () => closeSocket(), [])

  // Um toast por vez; o novo substitui o anterior e reinicia o relógio.
  const toast = useCallback((t: ToastInput) => {
    window.clearTimeout(timer.current)
    setCurrentToast({ ...t, id: ++seq.current })
    timer.current = window.setTimeout(() => setCurrentToast(null), t.action ? TOAST_ACTION_MS : TOAST_MS)
  }, [])

  const setWa = useCallback((next: WhatsAppStatusDTO) => {
    setWaState(next)
    if (next.status !== 'conectado') {
      // Ao desconectar, desliga IA, Follow-up e Disparos.
      setAutomations({ ia: false, followup: false, disparos: false })
    }
  }, [])

  const connectedRef = useRef(connected)
  connectedRef.current = connected
  const agentNameRef = useRef(agentName)
  agentNameRef.current = agentName

  // Estado vindo do servidor (socket ou ressincronização). Só trata a queda da conexão:
  // promover para "conectado" é papel dos fluxos de conexão (eles têm o passo final de importação).
  // Se o celular desconectou, avisa e desliga as automações no cliente.
  const applyServerWa = useCallback(
    (status: WhatsAppStatusDTO['status'], numero: string | null) => {
      if (!connectedRef.current) return
      if (status === 'conectado') {
        setWaState((cur) => (numero && numero !== cur.numero ? { ...cur, numero } : cur))
        return
      }
      setWaState((cur) => ({ ...cur, status, qr: undefined }))
      setAutomations({ ia: false, followup: false, disparos: false })
      // Persiste o desligamento: sem isso, ao reconectar as automações voltariam ligadas sozinhas.
      for (const key of ['ia', 'followup', 'disparos'] as const) {
        void fetch('/api/automations', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, on: false }),
        }).catch(() => {})
      }
      toast({ icon: <Plugs size={18} weight="fill" />, title: 'WhatsApp desconectado', text: 'As automações foram desligadas' })
    },
    [toast],
  )

  useSocketEvent('connection.update', ({ status, numero }) => applyServerWa(status, numero))

  // Reconexão do socket: eventos podem ter se perdido, então consulta o estado real.
  const socketSeenOnce = useRef(false)
  useRawSocketEvent('connect', () => {
    if (!socketSeenOnce.current) {
      socketSeenOnce.current = true
      return
    }
    fetch('/api/wa/status', { cache: 'no-store' })
      .then(async (res) => {
        redirectIfUnauthorized(res.status)
        if (!res.ok) return
        const s = (await res.json()) as WhatsAppStatusDTO
        applyServerWa(s.status, s.numero)
      })
      .catch(() => {})
  })

  // A IA passou a conversa para o usuário.
  useSocketEvent('handoff.requested', (p) => {
    toast({
      icon: <Hand size={18} weight="fill" />,
      title: `${agentNameRef.current} passou ${p.contactName} para você`,
      text: p.motivo,
    })
    window.dispatchEvent(new CustomEvent<HandoffRequestedPayload>(HANDOFF_WINDOW_EVENT, { detail: p }))
  })

  // A agenda mudou por fora (cliente agendou pelo link público): atualiza as telas e avisa o dono.
  useSocketEvent('agenda.updated', (p) => {
    emitAgendaChanged()
    if (!p.link) return
    const at = toSp(p.link.inicio)
    const [, mm, dd] = at.date.split('-')
    toast({
      icon: <CalendarCheck size={18} weight="fill" />,
      title: 'Novo agendamento pelo link',
      text: `${p.link.cliente}, ${dd}/${mm} ${at.hm}`,
    })
  })

  // Recarrega os cartões dos WhatsApps. A tela é do espaço `workspaceId`; se o servidor diz que o ativo agora é outro
  // (troca feita em outra aba), recarrega a página inteira para nunca mostrar/operar dados do espaço errado.
  const refreshSpaces = useCallback(async () => {
    try {
      const res = await fetch('/api/spaces', { cache: 'no-store' })
      redirectIfUnauthorized(res.status)
      if (!res.ok) return
      const next = (await res.json()) as SpacesResponse
      if (next.ativoId !== workspaceId) {
        window.location.reload()
        return
      }
      setSpaces(next)
    } catch {
      // mantém a última lista conhecida
    }
  }, [workspaceId])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSpaces()
    }
    const t = window.setInterval(onVisible, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshSpaces])

  // Aviso leve de OUTROS espaços da organização (contadores e passagens da IA). Eventos completos só vêm do ativo.
  useSocketEvent('space.attention', (p: SpaceAttentionPayload) => {
    if (p.workspaceId === workspaceId) return
    setSpaces((cur) => ({
      ...cur,
      espacos: cur.espacos.map((e: SpaceDTO) => (e.id === p.workspaceId ? { ...e, nome: p.nome, unread: p.unread, handoffs: p.handoffs } : e)),
    }))
    if (p.handoff) {
      toast({
        icon: <Hand size={18} weight="fill" />,
        title: `${p.nome}: ${p.handoff.agente} passou ${p.handoff.contato} para você`,
        text: p.handoff.motivo,
        action: {
          label: 'Ir para esse WhatsApp',
          onClick: () => {
            void fetch('/api/spaces/switch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspaceId: p.workspaceId }),
            })
              .then((r) => {
                if (r.ok) window.location.assign('/whatsapp')
              })
              .catch(() => {})
          },
        },
      })
    }
  })

  const setAutomation = useCallback(
    async (key: AutomationKey, on: boolean) => {
      if (on && !connected) {
        toast({
          icon: <LockSimple size={18} weight="fill" />,
          title: 'Conecte o WhatsApp primeiro',
          text: `Depois disso você pode ligar ${AUTOMATION_TITLES[key]}`,
        })
        return
      }
      const prev = automations[key]
      setAutomations((a) => ({ ...a, [key]: on }))
      try {
        const res = await fetch('/api/automations', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, on }),
        })
        redirectIfUnauthorized(res.status)
        if (!res.ok) throw new Error(String(res.status))
      } catch {
        setAutomations((a) => ({ ...a, [key]: prev }))
        toast({
          icon: <Warning size={18} weight="fill" />,
          title: 'Não foi possível salvar',
          text: 'Tente novamente em instantes.',
        })
        return
      }
      if (key === 'ia') {
        toast(
          on
            ? { icon: <Sparkle size={18} weight="fill" />, title: 'Agente de IA ligado', text: `${agentName} vai responder as próximas conversas` }
            : { icon: <PauseCircle size={18} weight="fill" />, title: 'Agente de IA desligado', text: 'Novas conversas ficam com você' },
        )
      } else if (key === 'disparos') {
        toast(
          on
            ? { icon: <PaperPlaneTilt size={18} weight="fill" />, title: 'Disparos ativados', text: 'Campanhas agendadas serão enviadas' }
            : { icon: <PauseCircle size={18} weight="fill" />, title: 'Disparos pausados', text: 'Nenhuma campanha será enviada' },
        )
      } else {
        toast(
          on
            ? { icon: <ClockClockwise size={18} weight="fill" />, title: 'Follow-up ligado', text: fuQueueCount > 0 ? `${fuQueueCount} contatos na fila de retomada` : 'Quem parar de responder entra na fila de retomada' }
            : { icon: <PauseCircle size={18} weight="fill" />, title: 'Follow-up desligado', text: 'Nenhuma retomada será enviada' },
        )
      }
    },
    [automations, connected, toast, agentName, fuQueueCount],
  )

  const closeDrawer = useCallback(() => setDrawer(null), [])
  const setUser = useCallback((patch: Partial<AppUser>) => setUserState((u) => ({ ...u, ...patch })), [])

  const value = useMemo<AppState>(
    () => ({
      wa,
      setWa,
      connected,
      automations,
      setAutomation,
      drawer,
      openDrawer: setDrawer,
      closeDrawer,
      toast,
      user,
      agentName,
      currentToast,
      setUser,
      setAgentName,
      fuQueueCount,
      setFuQueueCount,
      spaces,
      workspaceId,
      connectCfg,
      refreshSpaces,
    }),
    [wa, setWa, connected, automations, setAutomation, drawer, closeDrawer, toast, user, agentName, currentToast, setUser, fuQueueCount, spaces, workspaceId, connectCfg, refreshSpaces],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppState fora do AppStateProvider')
  return v
}
