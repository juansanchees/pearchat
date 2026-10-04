'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { usePermissions } from '@/components/app/use-permissions'
import { QR_ATALHO_MAX, QR_MAX_PER_SPACE, QR_TEXTO_MAX, parseAtalho } from '@/lib/quick-replies'
import type { QuickReplyDTO, QuickReplyList } from '@/lib/quick-replies'
import { api } from './api'
import { Section } from './parts'

const box = 'flex flex-col gap-2 rounded-md border border-light-divider px-[14px] py-3'
const iconBtn = 'grid h-7 w-7 flex-none place-items-center rounded-md border-0 bg-transparent p-0 text-light-neutral-500 hover:bg-[rgba(29,33,23,.07)] disabled:opacity-40 disabled:hover:bg-transparent'

type Draft = { id: string | null; atalho: string; texto: string }

// Seção "Respostas rápidas" das Configurações: atalhos de texto do composer ("/pix"), por WhatsApp.
export function QuickRepliesSection() {
  const { toast } = useAppState()
  // Equipe: o atendente só usa as respostas (modo leitura); criar/editar/excluir/reordenar é do dono e do administrador.
  const manage = usePermissions().can('quickreplies.manage')
  const [items, setItems] = useState<QuickReplyDTO[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string>()

  useEffect(() => {
    let alive = true
    api<QuickReplyList>('/api/quick-replies')
      .then((d) => alive && setItems(d.items))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [])

  // Aberto por "Gerenciar respostas rápidas" no composer: rola até aqui assim que a lista aparece.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const w = window as unknown as { __pcScrollQr?: number }
    // A marca vale por 15 s (o composer a grava ao abrir o drawer) e é consumida uma vez.
    if (items === null || !w.__pcScrollQr || Date.now() - w.__pcScrollQr > 15000) return
    w.__pcScrollQr = 0
    // Duas tentativas: logo e depois da animação de entrada do drawer, que pode reposicionar a rolagem.
    const go = () => {
      const el = rootRef.current
      const box = el?.parentElement
      if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 22
    }
    requestAnimationFrame(go)
    const t = window.setTimeout(go, 400)
    return () => window.clearTimeout(t)
  }, [items])

  const fail = (title: string, e: unknown) => toast({ title, text: e instanceof Error ? e.message : 'Tente novamente em instantes.' })

  async function save() {
    if (!draft || busy) return
    const a = parseAtalho(draft.atalho)
    if (!a.ok) return setErro(a.error)
    if (!draft.texto.trim()) return setErro('Escreva o texto da resposta.')
    setBusy(true)
    setErro(undefined)
    try {
      const body = { atalho: a.atalho, texto: draft.texto }
      if (draft.id) {
        const r = await api<QuickReplyDTO>(`/api/quick-replies/${draft.id}`, { method: 'PATCH', body })
        setItems((l) => (l ?? []).map((x) => (x.id === r.id ? r : x)))
      } else {
        const r = await api<QuickReplyDTO>('/api/quick-replies', { method: 'POST', body })
        setItems((l) => [...(l ?? []), r])
      }
      setDraft(null)
      toast({ title: 'Resposta salva', text: `Digite /${a.atalho} na conversa para usar` })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Tente novamente em instantes.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/quick-replies/${id}`, { method: 'DELETE' })
      setItems((l) => (l ?? []).filter((x) => x.id !== id))
      setConfirmId(null)
      toast({ title: 'Resposta removida' })
    } catch (e) {
      fail('Não foi possível remover', e)
    } finally {
      setBusy(false)
    }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!items || busy) return
    const j = index + dir
    if (j < 0 || j >= items.length) return
    const before = items
    const next = [...items]
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    setItems(next)
    setBusy(true)
    try {
      await api('/api/quick-replies/order', { method: 'PUT', body: { ids: next.map((x) => x.id) } })
    } catch (e) {
      setItems(before)
      fail('Não foi possível reordenar', e)
    } finally {
      setBusy(false)
    }
  }

  const editor = draft ? (
    <div className={box}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] text-light-neutral-500">/</span>
        <input
          className="pc-input font-mono"
          aria-label="Atalho"
          placeholder="atalho"
          maxLength={QR_ATALHO_MAX + 1}
          value={draft.atalho}
          onChange={(e) => setDraft({ ...draft, atalho: e.target.value })}
          autoFocus
        />
      </div>
      <textarea
        className="pc-input"
        aria-label="Texto da resposta"
        placeholder="Texto que entra no campo de mensagem"
        maxLength={QR_TEXTO_MAX}
        value={draft.texto}
        onChange={(e) => setDraft({ ...draft, texto: e.target.value })}
      />
      {erro ? <div className="text-[11.5px] text-[#a4452c]">{erro}</div> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => { setDraft(null); setErro(undefined) }}>
          Cancelar
        </button>
        <button type="button" className="pc-btn pc-btn-primary !text-[12px]" disabled={busy} onClick={() => void save()}>
          <Check size={14} />
          Salvar
        </button>
      </div>
    </div>
  ) : null

  return (
    <div id="respostas-rapidas" ref={rootRef}>
      <Section
        label="Respostas rápidas"
        aside={
          !manage ? null : <button
            type="button"
            className="pc-btn pc-btn-ghost !text-[12px]"
            disabled={!items || !!draft || items.length >= QR_MAX_PER_SPACE}
            onClick={() => { setDraft({ id: null, atalho: '', texto: '' }); setErro(undefined) }}
          >
            <Plus size={13} />
            Nova resposta
          </button>
        }
      >
        <div className="text-[11.5px] text-light-neutral-500">
          Digite <span className="font-mono">/</span> na conversa para inserir. Variáveis: {'{primeiro_nome}'}, {'{nome}'}, {'{empresa}'} e {'{horario}'} (o horário de atendimento deste WhatsApp).
        </div>
        {!manage ? <div className="text-[11.5px] text-light-neutral-500">Somente leitura: quem administra o WhatsApp cria e edita as respostas.</div> : null}
        {draft && !draft.id ? editor : null}
        {items === null ? <div className="text-[12px] text-light-neutral-500">Carregando…</div> : null}
        {items?.length === 0 && !draft ? <div className="text-[12px] text-light-neutral-500">{manage ? 'Nenhuma resposta ainda. Crie a primeira em "Nova resposta".' : 'Nenhuma resposta cadastrada neste WhatsApp.'}</div> : null}
        {items?.map((it, i) =>
          draft?.id === it.id ? (
            <div key={it.id}>{editor}</div>
          ) : (
            <div key={it.id} className={box}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-light-accent-300">/{it.atalho}</span>
                <span className="flex-none text-[11px] text-light-neutral-500">{it.usos === 1 ? '1 uso' : `${it.usos} usos`}</span>
                {confirmId === it.id ? (
                  <>
                    <span className="flex-none text-[11.5px]">Remover?</span>
                    <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" disabled={busy} onClick={() => void remove(it.id)}>
                      Remover
                    </button>
                    <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setConfirmId(null)}>
                      Manter
                    </button>
                  </>
                ) : manage ? (
                  <>
                    <button type="button" className={iconBtn} title="Subir" aria-label={`Subir /${it.atalho}`} disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className={iconBtn} title="Descer" aria-label={`Descer /${it.atalho}`} disabled={busy || i === items.length - 1} onClick={() => void move(i, 1)}>
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      title="Editar"
                      aria-label={`Editar /${it.atalho}`}
                      onClick={() => { setDraft({ id: it.id, atalho: it.atalho, texto: it.texto }); setErro(undefined) }}
                    >
                      <PencilSimple size={14} />
                    </button>
                    <button type="button" className={iconBtn} title="Remover" aria-label={`Remover /${it.atalho}`} onClick={() => setConfirmId(it.id)}>
                      <Trash size={14} />
                    </button>
                  </>
                ) : null}
              </div>
              {/* Texto puro: o React escapa, nunca é interpretado como HTML. */}
              <div className="line-clamp-2 whitespace-pre-wrap break-words text-[12.5px] text-light-neutral-500">{it.texto}</div>
            </div>
          ),
        )}
      </Section>
    </div>
  )
}
