'use client'

import { useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  DotsSixVertical,
  PencilSimple,
  Plus,
  TrashSimple,
  Warning,
} from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { emitAgendaChanged } from '@/components/app/events'
import { Spinner } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { ServiceTypeDto, ServiceTypeListResponse } from '@/server/calendar/types'
import { TIPO_CORES, TIPO_DUR_OPTS, api } from './data'
import { durLabel } from './time'

type Draft = { key: string; id: string | null; nome: string; duracaoMin: number; cor: string | null }

let seq = 0
const newKey = () => `n${++seq}`

const toDraft = (t: ServiceTypeDto): Draft => ({ key: t.id, id: t.id, nome: t.nome, duracaoMin: t.duracaoMin, cor: t.cor })

/** Rótulo curto da duração no select ("30 min", "1 h", "1h30"). */
const durOpt = (min: number) => (min >= 60 && min % 60 === 30 ? `${Math.floor(min / 60)}h30` : durLabel(min))

/** Editor "Tipos de atendimento" (dentro do painel lateral da Agenda). */
export function ServiceTypeEditor({
  tipos,
  onCancel,
  onSaved,
}: {
  tipos: ServiceTypeDto[]
  onCancel: () => void
  onSaved: (tipos: ServiceTypeDto[]) => void
}) {
  const { toast } = useAppState()
  const [rows, setRows] = useState<Draft[]>(() => tipos.map(toDraft))
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragKey = useRef<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  const patchRow = (key: string, p: Partial<Draft>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const move = (from: number, to: number) =>
    setRows((r) => {
      if (to < 0 || to >= r.length || from === to) return r
      const next = [...r]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })

  const original = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos])

  const save = async () => {
    const names = rows.map((r) => r.nome.trim())
    if (rows.length === 0) return setError('Mantenha ao menos um tipo de atendimento.')
    if (names.some((n) => !n)) return setError('Dê um nome a todos os tipos.')
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return setError('Dois tipos têm o mesmo nome.')
    setError(null)
    setSaving(true)
    try {
      // Um tipo novo com o nome de um removido reaproveita o removido (evita conflito de nome).
      const kept = new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))
      const removed = tipos.filter((t) => !kept.has(t.id))
      const resolved = rows.map((r) => {
        if (r.id) return r
        const match = removed.find((t) => t.nome.toLowerCase() === r.nome.trim().toLowerCase())
        if (!match) return r
        removed.splice(removed.indexOf(match), 1)
        return { ...r, id: match.id }
      })
      const ids: string[] = []
      // 1) criar, 2) remover, 3) alterar, 4) ordenar (nessa ordem, para nunca ficar sem tipos).
      const created = new Map<string, string>()
      for (const r of resolved.filter((x) => !x.id)) {
        const res = await api<{ tipo: ServiceTypeDto }>('/api/service-types', {
          method: 'POST',
          body: { nome: r.nome.trim(), duracaoMin: r.duracaoMin, cor: r.cor },
        })
        created.set(r.key, res.tipo.id)
      }
      for (const t of removed) await api(`/api/service-types/${t.id}`, { method: 'DELETE' })
      for (const r of resolved) {
        if (!r.id) continue
        const o = original.get(r.id)
        const body: Record<string, unknown> = {}
        if (o?.nome !== r.nome.trim()) body.nome = r.nome.trim()
        if (o?.duracaoMin !== r.duracaoMin) body.duracaoMin = r.duracaoMin
        if ((o?.cor ?? null) !== r.cor) body.cor = r.cor
        if (Object.keys(body).length > 0) await api(`/api/service-types/${r.id}`, { method: 'PATCH', body })
      }
      for (const r of resolved) ids.push(r.id ?? created.get(r.key) ?? '')
      const res = await api<ServiceTypeListResponse>('/api/service-types/order', { method: 'PUT', body: { ids } })
      toast({ icon: <Check size={18} weight="fill" />, title: 'Tipos de atendimento salvos', text: 'Eles já aparecem ao agendar' })
      emitAgendaChanged()
      onSaved(res.tipos)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Tente novamente em instantes.'
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível salvar os tipos', text: msg })
      setError(msg)
      // Recarrega o que de fato ficou salvo, para o editor não divergir do servidor.
      try {
        onSaved((await api<ServiceTypeListResponse>('/api/service-types')).tipos)
      } catch {
        /* ignora */
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-light-surface p-4">
      <h2 className="m-0 flex items-center gap-[7px] text-[14px] font-medium leading-[1.2] tracking-normal">
        <PencilSimple size={15} className="text-light-accent-300" /> Tipos de atendimento
      </h2>
      <p className="m-0 text-[11.5px] text-light-neutral-500 [text-wrap:pretty]">
        Defina os serviços do seu negócio. Eles aparecem ao agendar e nos lembretes.
      </p>

      <div className="flex flex-col gap-2" role="list">
        {rows.map((r, i) => (
          <div
            key={r.key}
            role="listitem"
            draggable
            onDragStart={() => (dragKey.current = r.key)}
            onDragOver={(e) => {
              e.preventDefault()
              setOverKey(r.key)
            }}
            onDragEnd={() => {
              dragKey.current = null
              setOverKey(null)
            }}
            onDrop={() => {
              const from = rows.findIndex((x) => x.key === dragKey.current)
              if (from >= 0) move(from, i)
              dragKey.current = null
              setOverKey(null)
            }}
            className={cn(
              'flex flex-col gap-1.5 rounded-md border border-solid px-2 py-2',
              overKey === r.key ? 'border-light-accent-600' : 'border-light-divider',
            )}
          >
            <div className="flex items-center gap-1.5">
              <DotsSixVertical size={14} className="flex-none cursor-grab text-light-neutral-500" aria-hidden />
              <input
                className="pc-input min-w-0 flex-1"
                value={r.nome}
                onChange={(e) => patchRow(r.key, { nome: e.target.value })}
                placeholder="Nome do serviço"
                aria-label={`Nome do tipo ${i + 1}`}
                maxLength={40}
              />
              <select
                className="pc-input w-[88px] flex-none px-2"
                value={r.duracaoMin}
                onChange={(e) => patchRow(r.key, { duracaoMin: Number(e.target.value) })}
                aria-label={`Duração de ${r.nome || `tipo ${i + 1}`}`}
              >
                {(TIPO_DUR_OPTS as readonly number[]).includes(r.duracaoMin) ? null : (
                  <option value={r.duracaoMin}>{durOpt(r.duracaoMin)}</option>
                )}
                {TIPO_DUR_OPTS.map((d) => (
                  <option key={d} value={d}>
                    {durOpt(d)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pl-5">
              <div className="flex flex-1 items-center gap-1.5" role="group" aria-label="Cor">
                {TIPO_CORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={r.cor === c}
                    aria-label={`Cor ${c}`}
                    title={r.cor === c ? 'Remover cor' : 'Usar esta cor'}
                    onClick={() => patchRow(r.key, { cor: r.cor === c ? null : c })}
                    className="h-[16px] w-[16px] cursor-pointer rounded-pill border-2 border-solid p-0"
                    style={{
                      background: c,
                      borderColor: r.cor === c ? 'var(--light-text)' : 'transparent',
                      opacity: r.cor && r.cor !== c ? 0.45 : 1,
                    }}
                  />
                ))}
              </div>
              {confirmKey === r.key ? (
                <div className="flex items-center gap-1 text-[11px] text-light-neutral-400" role="group" aria-label="Confirmar remoção">
                  <span>Remover?</span>
                  <button
                    type="button"
                    disabled={rows.length <= 1}
                    title={rows.length <= 1 ? 'Mantenha ao menos um tipo' : undefined}
                    onClick={() => {
                      setRows((x) => x.filter((y) => y.key !== r.key))
                      setConfirmKey(null)
                    }}
                    className="rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-light-accent-300 hover:bg-[rgba(29,33,23,.07)] disabled:opacity-50"
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmKey(null)}
                    className="rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] text-light-neutral-400 hover:bg-[rgba(29,33,23,.07)]"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <div className="flex flex-none items-center">
                  <IconBtn label="Subir" disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <ArrowUp size={12} />
                  </IconBtn>
                  <IconBtn label="Descer" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                    <ArrowDown size={12} />
                  </IconBtn>
                  <IconBtn label={`Remover ${r.nome || 'tipo'}`} onClick={() => setConfirmKey(r.key)}>
                    <TrashSimple size={12} />
                  </IconBtn>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((r) => [...r, { key: newKey(), id: null, nome: '', duracaoMin: 30, cor: null }])}
        className="pc-btn pc-btn-secondary self-start px-2.5 py-1 text-[12px]"
      >
        <Plus size={12} /> Adicionar tipo
      </button>

      {error && (
        <div role="alert" className="text-[11.5px] text-[#c9806b]">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={saving} className="pc-btn pc-btn-primary flex-1">
          {saving ? <Spinner size={14} /> : <Check size={14} />} Salvar
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="pc-btn pc-btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-md border-0 bg-transparent p-0 text-light-neutral-500 hover:bg-[rgba(29,33,23,.07)] hover:text-light-text disabled:opacity-30"
    >
      {children}
    </button>
  )
}
