'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ClockClockwise, Hand, LockSimple, PaperPlaneTilt, PauseCircle, Plugs, Sparkle, Warning } from '@phosphor-icons/react'
import type { AutomationKey, DrawerKey, WhatsAppStatusDTO } from '@/lib/types'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { closeSocket, useRawSocketEvent, useSocketEvent } from '@/lib/socket-client'
import { AUTOMATION_TITLES } from './automations'
import { HANDOFF_WINDOW_EVENT } from './handoff'
import type { HandoffRequestedPayload } from './handoff'

export type ToastInput = { icon?: ReactNode; title: string; text?: string }
export type AppUser = { nome: string; email: string; empresa: string; fotoUrl: string | null }
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
}

const Ctx = createContext<AppState | null>(null)
const TOAST_MS = 3800

export function AppStateProvider({
  initial,
  children,
}: {
  initial: { wa: WhatsAppStatusDTO; automations: Record<AutomationKey, boolean>; user: AppUser; agentName: string; fuQueueCount: number }
  children: ReactNode
}) {
  const [wa, setWaState] = useState(initial.wa)
  const [automations, setAutomations] = useState(initial.automations)
  const [drawer, setDrawer] = useState<DrawerKey | null>(null)
  const [currentToast, setCurrentToast] = useState<ToastItem | null>(null)
  const [user, setUserState] = useState(initial.user)
  const [agentName, setAgentName] = useState(initial.agentName)
  const [fuQueueCount, setFuQueueCount] = useState(initial.fuQueueCount)
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
    timer.current = window.setTimeout(() => setCurrentToast(null), TOAST_MS)
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
    }),
    [wa, setWa, connected, automations, setAutomation, drawer, closeDrawer, toast, user, agentName, currentToast, setUser, fuQueueCount],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppState(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppState fora do AppStateProvider')
  return v
}
