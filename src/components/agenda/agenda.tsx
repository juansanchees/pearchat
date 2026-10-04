'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowClockwise, CalendarCheck, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { emitAgendaChanged } from '@/components/app/events'
import { Spinner } from '@/components/pear'
import type { CalendarStateDto } from '@/server/calendar/types'
import { ConnectFlow } from './connect-flow'
import type { ConnectStep } from './connect-flow'
import { ConnectedView } from './connected-view'
import type { CalendarPatch } from './connected-view'
import { api } from './data'
import { agoLabel } from './time'
import { AgendaTopBar } from './top-bar'
import { useCalendarState } from './use-agenda'

const ERROS: Record<string, { title: string; text: string }> = {
  negado: { title: 'Acesso não autorizado', text: 'Você não liberou o acesso ao Google Agenda. Tente de novo quando quiser.' },
  estado: { title: 'A conexão expirou', text: 'Por segurança, o pedido vale por 10 minutos. Clique em Google Agenda e tente de novo.' },
  sem_refresh: {
    title: 'O Google não liberou o acesso contínuo',
    text: 'Remova o PearChat em myaccount.google.com/permissions e conecte de novo.',
  },
  sem_agendas: { title: 'Nenhuma agenda encontrada', text: 'Essa conta do Google não tem agendas disponíveis.' },
  google: { title: 'Não foi possível conectar', text: 'O Google não concluiu a conexão. Tente de novo.' },
}

/** Tela da Agenda (usa useSearchParams: renderizar dentro de <Suspense>). */
export function Agenda() {
  const sp = useSearchParams()
  const router = useRouter()
  const { toast, agentName } = useAppState()
  const { cal, setCal, loading, error, reload } = useCalendarState()
  const [step, setStep] = useState<ConnectStep>(null)
  const [realMode, setRealMode] = useState(false)
  // Sem Google conectado a Agenda abre na grade (eventos do PearChat); o fluxo de conexão abre pelo aviso do topo.
  const [flowOpen, setFlowOpen] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // Atualiza o "há X min" do status a cada 30 s.
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const passo = sp.get('passo')
  const erro = sp.get('erro')
  const clienteParam = sp.get('cliente')

  // Retorno do OAuth real: ?passo=agendas abre a escolha de agendas; ?erro=google avisa a falha.
  useEffect(() => {
    if (!passo && !erro) return
    if (passo === 'agendas') {
      setRealMode(true)
      setStep('agendas')
    }
    if (erro) {
      const msg = ERROS[erro] ?? ERROS.google
      toast({ icon: <Warning size={18} weight="fill" />, title: msg.title, text: msg.text })
    }
    router.replace(clienteParam ? `/agenda?cliente=${encodeURIComponent(clienteParam)}` : '/agenda')
  }, [passo, erro, clienteParam, router, toast])

  const patch = useCallback(
    async (body: CalendarPatch) => {
      if (!cal) return false
      const prev = cal
      setCal({ ...prev, ...body })
      try {
        setCal(await api<CalendarStateDto>('/api/calendar', { method: 'PATCH', body }))
        return true
      } catch {
        setCal(prev)
        toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível salvar', text: 'Tente novamente em instantes.' })
        return false
      }
    },
    [cal, setCal, toast],
  )

  const toggleIa = async () => {
    if (!cal) return
    const on = !cal.iaPodeAgendar
    if (!(await patch({ iaPodeAgendar: on }))) return
    toast(
      on
        ? { icon: <CalendarCheck size={18} weight="fill" />, title: 'IA pode agendar', text: `${agentName} oferece horários livres aos clientes` }
        : { icon: <CalendarCheck size={18} weight="fill" />, title: 'IA não agenda mais', text: 'Só você marca horários' },
    )
  }

  // Na volta do OAuth a conexão já existe, mas a tela continua no passo de agendas até "Concluir conexão".
  const pickingReal = realMode && step === 'agendas' && !!cal?.conectado
  const inFlow = !!cal && (pickingReal || (!cal.conectado && flowOpen))
  const gOn = !!cal?.conectado && !pickingReal
  const showGrid = !!cal && !inFlow
  const subtitle = !cal
    ? 'Carregando…'
    : !gOn
      ? 'Agenda do PearChat · Google Agenda não conectado'
      : cal.demo
        ? `${cal.email || 'Google'} · modo de demonstração`
        : cal.precisaReconectar
          ? 'Sua conexão com o Google expirou'
          : `Sincronizado com ${cal.email || 'Google'} · ${agoLabel(syncedAt ?? cal.sincronizadoEm)}`

  return (
    <div className="flex h-full min-h-0 flex-col bg-light-bg text-light-text">
      <AgendaTopBar subtitle={subtitle} showIa={gOn} iaOn={!!cal?.iaPodeAgendar} onIa={() => void toggleIa()} />

      {loading && !cal && (
        <div className="grid flex-1 place-items-center">
          <Spinner />
        </div>
      )}

      {error && !cal && !loading && (
        <div className="grid flex-1 place-items-center p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Warning size={24} className="text-light-neutral-500" />
            <div className="text-[13px] text-light-neutral-400">Não foi possível carregar a agenda.</div>
            <button type="button" onClick={() => void reload()} className="pc-btn pc-btn-secondary text-[12px]">
              <ArrowClockwise size={13} /> Tentar de novo
            </button>
          </div>
        </div>
      )}

      {cal && inFlow && (
        <ConnectFlow
          cal={cal}
          step={step === 'agendas' && realMode && !pickingReal ? null : step}
          onStep={setStep}
          realMode={pickingReal}
          onConnected={(next) => {
            setCal(next)
            setRealMode(false)
            setFlowOpen(false)
            emitAgendaChanged()
          }}
          onClose={() => {
            setStep(null)
            setFlowOpen(false)
          }}
        />
      )}

      {cal && showGrid && (
        <ConnectedView
          cal={cal}
          onConnectGoogle={() => {
            setStep(null)
            setFlowOpen(true)
          }}
          patch={patch}
          clienteParam={clienteParam}
          onSynced={setSyncedAt}
          onDisconnected={(next) => {
            setCal(next)
            setStep(null)
            emitAgendaChanged()
          }}
        />
      )}
    </div>
  )
}
