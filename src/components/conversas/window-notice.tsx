'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClockCountdown, PaperPlaneTilt } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { usePermissions } from '@/components/app/use-permissions'
import { api } from '@/components/drawers/api'

type WindowInfo = {
  provider: 'oficial' | 'rapida' | null
  open: boolean
  expiresAt: string | null
  templates: Array<{ id: string; name: string; body: string; vars: number; category: 'MARKETING' | 'UTILIDADE' }>
  firstName: string
}

/** Texto do modelo com as variáveis já preenchidas (prévia). */
const fill = (body: string, vars: string[]) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, i: string) => vars[Number(i) - 1] || `{{${i}}}`)

/**
 * Aviso da janela de 24 h (API oficial): aparece ACIMA do campo de mensagem quando o cliente não escreve há mais de 24 h.
 * Só modelos aprovados saem dali; a lista vem do servidor. Na conexão rápida não renderiza nada.
 */
export function WindowNotice({ conversationId, refreshKey }: { conversationId: string; refreshKey: string }) {
  const { toast, openDrawer } = useAppState()
  const { can } = usePermissions()
  const [info, setInfo] = useState<WindowInfo | null>(null)
  const [tplId, setTplId] = useState('')
  const [vars, setVars] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      setInfo(await api<WindowInfo>(`/api/conversations/${conversationId}/window`))
    } catch {
      setInfo(null)
    }
  }, [conversationId])

  // Recarrega ao trocar de conversa e quando chega/sai mensagem (refreshKey = id da última mensagem).
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Janela aberta: reavalia quando ela vencer, sem esperar outra mensagem.
  useEffect(() => {
    if (!info?.open || !info.expiresAt) return
    const ms = new Date(info.expiresAt).getTime() - Date.now() + 1000
    if (ms <= 0 || ms > 2 ** 31 - 1) return
    const t = window.setTimeout(() => void load(), ms)
    return () => window.clearTimeout(t)
  }, [info, load])

  const tpl = info?.templates.find((t) => t.id === tplId)
  useEffect(() => {
    if (!tpl) return setVars([])
    setVars(Array.from({ length: tpl.vars }, (_, i) => (i === 0 ? (info?.firstName ?? '') : '')))
  }, [tpl, info?.firstName])

  if (!info || info.provider !== 'oficial' || info.open) return null

  const ready = !!tpl && vars.every((v) => v.trim())
  const send = async () => {
    if (!tpl || !ready || sending) return
    setSending(true)
    try {
      await api(`/api/conversations/${conversationId}/template`, { method: 'POST', body: { templateId: tpl.id, vars } })
      toast({ icon: <PaperPlaneTilt size={18} weight="fill" />, title: 'Modelo enviado', text: tpl.name })
      setTplId('')
    } catch (e) {
      toast({ icon: <ClockCountdown size={18} weight="fill" />, title: 'Não foi possível enviar o modelo', text: e instanceof Error ? e.message : 'Tente novamente' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div role="status" className="flex-none border-0 border-t border-solid border-amber-border bg-amber-bg px-4 py-2.5 text-amber-text max-[899px]:px-3">
      <div className="flex items-center gap-2 text-[12.5px] font-medium leading-tight">
        <ClockCountdown size={16} className="flex-none" />
        Janela de 24 h encerrada: envie um modelo aprovado
      </div>
      {info.templates.length === 0 ? (
        <div className="mt-1.5 text-[12px] leading-[1.45]">
          Você ainda não tem modelo aprovado pela Meta.{' '}
          {can('campaigns.manage') && (
            <button type="button" className="border-0 bg-transparent p-0 text-[12px] text-amber-text underline" onClick={() => openDrawer('disparos')}>
              Criar um modelo em Disparos
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select className="pc-input !w-auto min-w-[200px]" aria-label="Modelo aprovado" value={tplId} onChange={(e) => setTplId(e.target.value)}>
              <option value="">Escolha um modelo…</option>
              {info.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="button" className="pc-btn pc-btn-primary !text-[12px] disabled:opacity-60" disabled={!ready || sending} onClick={() => void send()}>
              <PaperPlaneTilt size={14} />
              {sending ? 'Enviando…' : 'Enviar modelo'}
            </button>
          </div>
          {tpl && (
            <>
              {tpl.vars > 0 && (
                <div className="flex flex-wrap gap-2">
                  {vars.map((v, i) => (
                    <input
                      key={i}
                      className="pc-input !w-auto min-w-[140px] flex-1"
                      aria-label={`Variável ${i + 1}`}
                      placeholder={`Variável ${i + 1}`}
                      value={v}
                      onChange={(e) => setVars((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  ))}
                </div>
              )}
              <div className="rounded-md border border-amber-border px-3 py-2 text-[12px] leading-[1.45]">{fill(tpl.body, vars)}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
