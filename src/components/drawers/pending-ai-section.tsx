'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkle, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { usePermissions } from '@/components/app/use-permissions'
import { Pill } from '@/components/pear'
import { api } from './api'
import { Section } from './parts'

type Janela = '24h' | '3d' | '7d'
type Pending = { total: number; porJanela: Record<Janela, number>; emAndamento: number; maxPorExecucao: number }
type Batch = { enfileiradas: number; restantes: number }

const JANELAS: { id: Janela; label: string; texto: string }[] = [
  { id: '24h', label: 'Últimas 24 h', texto: 'nas últimas 24 horas' },
  { id: '3d', label: '3 dias', texto: 'nos últimos 3 dias' },
  { id: '7d', label: '7 dias', texto: 'nos últimos 7 dias' },
]
/** Chave do aviso "Responder com a IA" (toast ao ligar a IA) para o drawer rolar até este bloco. */
export const FOCUS_PENDING_KEY = 'pearchat:focus-pending'

const plural = (n: number) => `${n} ${n === 1 ? 'conversa' : 'conversas'}`

// "Conversas esperando resposta": a IA responde as conversas em que o cliente escreveu e ninguém respondeu (ex.: a mensagem
// chegou com a IA desligada). A regra, os limites (7 dias, 50 por vez, espaço entre as respostas) e as travas são do servidor.
export function PendingAiSection() {
  const { automations, connected, toast, agentName } = useAppState()
  const { can } = usePermissions()
  const allowed = can('agent.manage') && connected && automations.ia
  const [janela, setJanela] = useState<Janela>('24h')
  const [data, setData] = useState<Pending | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<Batch | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<Pending>(`/api/conversations/pending-ai?janela=${janela}`))
    } catch {
      /* some até a próxima consulta */
    }
  }, [janela])

  // Consulta ao abrir e a cada poucos segundos enquanto o drawer está aberto (mais rápido enquanto a IA responde o lote).
  const running = (data?.emAndamento ?? 0) > 0
  useEffect(() => {
    if (!allowed) return
    void load()
    const t = window.setInterval(() => void load(), running ? 4_000 : 15_000)
    return () => window.clearInterval(t)
  }, [allowed, load, running])

  // Veio do aviso ao ligar a IA: rola até aqui uma vez.
  useEffect(() => {
    if (!data) return
    try {
      if (sessionStorage.getItem(FOCUS_PENDING_KEY)) {
        sessionStorage.removeItem(FOCUS_PENDING_KEY)
        ref.current?.scrollIntoView({ block: 'start' })
      }
    } catch {
      /* sem sessionStorage */
    }
  }, [data])

  if (!allowed) return null
  const total = data?.porJanela[janela] ?? 0
  if (!data || (data.porJanela['7d'] === 0 && !running && !last)) return null
  const info = JANELAS.find((j) => j.id === janela) ?? JANELAS[0]
  const toDo = Math.min(total, data.maxPorExecucao)

  const responder = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api<Batch>('/api/conversations/pending-ai/reply', { method: 'POST', body: { janela } })
      setLast(r)
      setConfirming(false)
      await load()
    } catch (e) {
      setConfirming(false)
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível responder', text: e instanceof Error ? e.message : 'Tente novamente em instantes.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref}>
      <Section label="Conversas esperando resposta" aside={<span className="text-[11px] text-light-neutral-500">{plural(total)}</span>}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
          {JANELAS.map((j) => (
            <Pill key={j.id} active={janela === j.id} onClick={() => { setJanela(j.id); setConfirming(false); setLast(null) }}>
              {j.label}
            </Pill>
          ))}
        </div>
        <div className="text-[12px] text-light-neutral-400">
          Clientes que escreveram {info.texto} e ainda não receberam resposta (por exemplo, porque a mensagem chegou com o agente desligado).
        </div>
        {running ? (
          <div className="flex items-center gap-2 rounded-md border border-light-accent-700 bg-light-accent-900 px-3 py-[10px] text-[12px] text-light-accent-200" role="status">
            <Sparkle size={14} weight="fill" className="flex-none animate-pulse" />
            Respondendo… faltam {data.emAndamento}. As respostas saem uma a uma, com intervalo entre elas.
          </div>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-light-divider px-3 py-[10px] text-[12px]">
            <span className="min-w-0 flex-1">
              {agentName} vai responder {plural(toDo)}, uma a uma, com intervalo entre elas.
              {total > toDo ? ` As outras ${total - toDo} ficam para a próxima vez.` : ''}
            </span>
            <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setConfirming(false)}>
              Voltar
            </button>
            <button type="button" disabled={busy} className="pc-btn pc-btn-primary !text-[12px] disabled:opacity-60" onClick={() => void responder()}>
              Confirmar
            </button>
          </div>
        ) : (
          <button type="button" disabled={total === 0} className="pc-btn pc-btn-secondary self-start disabled:opacity-60" onClick={() => setConfirming(true)}>
            <Sparkle size={14} />
            Responder com a IA
          </button>
        )}
        {last && !running ? (
          <div className="text-[12px] text-light-neutral-400">
            {last.enfileiradas === 0 ? 'Nenhuma conversa para responder agora.' : `${plural(last.enfileiradas)} respondida${last.enfileiradas === 1 ? '' : 's'}.`}
            {last.restantes > 0 ? ` Ainda há ${plural(last.restantes)} esperando: peça de novo para continuar.` : ''}
          </div>
        ) : null}
      </Section>
    </div>
  )
}
