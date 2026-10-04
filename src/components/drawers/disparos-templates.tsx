'use client'

import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ArrowsClockwise, CheckCircle, Clock, PaperPlaneTilt, Plus, Trash, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { Tag } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { TemplateDTO } from '@/lib/types'
import { SUGGESTED_TEMPLATES, countTemplateVars, validateTemplateDraft } from '@/server/whatsapp/template-rules'
import { api } from './api'
import { templateUsable, toTemplate } from './drawer-data'
import type { Template } from './mock-data'
import { ChatBubble, Field, RadioCard, Section, Seg } from './parts'

const linkBtn = 'inline-flex items-center gap-1 bg-transparent p-0 text-[12px] text-light-accent-300 hover:underline disabled:opacity-60'
const CATS = ['Marketing', 'Utilidade'] as const

type Form = { id?: string; name: string; cat: (typeof CATS)[number]; body: string; examples: string[] }

const STATUS_STYLE: Record<Template['status'], string> = {
  Aprovado: 'text-light-accent-300',
  'Em análise': 'text-[#b0872f]',
  Rejeitado: 'text-[#b0472f]',
  Pausado: 'text-[#b0872f]',
  Desativado: 'text-[#b0472f]',
}

/** Prévia: {{1}} vira "Ana"; as demais usam o exemplo enviado à Meta. */
export const previewTemplate = (t: Template): string =>
  t.corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, i: string) => (Number(i) === 1 ? 'Ana' : (t.exemplos?.[Number(i) - 1] ?? `{{${i}}}`)))

export function OficialTemplates({
  templates,
  setTemplates,
  tplSel,
  setTplSel,
}: {
  templates: Template[]
  setTemplates: Dispatch<SetStateAction<Template[]>>
  tplSel: string
  setTplSel: (id: string) => void
}) {
  const { toast } = useAppState()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  const warn = (title: string, e: unknown) =>
    toast({ icon: <Warning size={18} weight="fill" />, title, text: e instanceof Error ? e.message : 'Tente novamente' })

  const sync = async () => {
    setBusy('sync')
    try {
      const list = await api<TemplateDTO[]>('/api/templates/sync', { method: 'POST' })
      setTemplates(list.map(toTemplate))
      toast({ icon: <CheckCircle size={18} weight="fill" />, title: 'Modelos atualizados', text: 'Status sincronizado com a Meta' })
    } catch (e) {
      warn('Não foi possível atualizar', e)
    } finally {
      setBusy(null)
    }
  }

  const openForm = (f: Form) => {
    setErrors([])
    setForm(f)
  }

  const submit = async () => {
    if (!form) return
    const n = countTemplateVars(form.body)
    const examples = form.examples.slice(0, n)
    const errs = validateTemplateDraft({
      name: form.name.trim() || undefined,
      category: form.cat === 'Marketing' ? 'MARKETING' : 'UTILIDADE',
      body: form.body,
      examples,
    })
    if (errs.length) return setErrors(errs)
    setErrors([])
    setBusy('submit')
    try {
      const novo = await api<TemplateDTO>('/api/templates', {
        method: 'POST',
        body: {
          ...(form.id ? { id: form.id } : {}),
          ...(form.name.trim() ? { name: form.name.trim() } : {}),
          category: form.cat === 'Marketing' ? 'MARKETING' : 'UTILIDADE',
          body: form.body.trim(),
          examples,
        },
      })
      const t = toTemplate(novo)
      setTemplates((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [...l, t]))
      setForm(null)
      toast({ icon: <Clock size={18} weight="fill" />, title: 'Modelo enviado para a Meta', text: `${t.nome} · ${t.status.toLowerCase()}` })
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Não foi possível criar o modelo'])
    } finally {
      setBusy(null)
    }
  }

  const remove = async (t: Template) => {
    setBusy(t.id)
    try {
      await api(`/api/templates/${t.id}`, { method: 'DELETE' })
      setTemplates((l) => l.filter((x) => x.id !== t.id))
      if (tplSel === t.id) setTplSel('')
      setConfirmDel(null)
      toast({ icon: <Trash size={18} weight="fill" />, title: 'Modelo excluído', text: t.nome })
    } catch (e) {
      warn('Não foi possível excluir', e)
    } finally {
      setBusy(null)
    }
  }

  const suggestions = SUGGESTED_TEMPLATES.filter((s) => !templates.some((t) => t.nome === s.name))
  const selected = templates.find((t) => t.id === tplSel)
  const nVars = form ? countTemplateVars(form.body) : 0

  return (
    <>
      <Section
        label="Modelo aprovado"
        gap="gap-3"
        aside={
          <span className="flex items-center gap-3">
            <button type="button" className={linkBtn} disabled={busy === 'sync'} onClick={() => void sync()}>
              <ArrowsClockwise size={13} />
              {busy === 'sync' ? 'Atualizando…' : 'Atualizar status'}
            </button>
            <button type="button" className={linkBtn} onClick={() => openForm({ name: '', cat: 'Marketing', body: '', examples: [] })}>
              <Plus size={13} />
              Criar modelo
            </button>
          </span>
        }
      >
        <div className="text-[12px] text-light-neutral-400">
          No WhatsApp oficial, disparos usam modelos aprovados pela Meta. A aprovação costuma levar de alguns minutos a algumas horas.
        </div>

        {form && (
          <div className="flex flex-col gap-3 rounded-md border border-light-divider bg-light-bg p-[14px]">
            <div className="text-[12.5px] font-medium">{form.id ? 'Enviar modelo para aprovação' : 'Novo modelo'}</div>
            <div className="flex flex-wrap gap-[14px]">
              <Field label="Nome (opcional)" className="min-w-0 flex-[1_1_200px]">
                <input
                  className="pc-input font-mono"
                  aria-label="Nome do modelo"
                  placeholder="gerado a partir do texto"
                  value={form.name}
                  disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Categoria" className="min-w-0 flex-[1_1_200px]">
                <Seg options={CATS} value={form.cat} onChange={(v) => setForm({ ...form, cat: v })} label="Categoria" />
              </Field>
            </div>
            <Field label="Texto">
              <textarea
                className="pc-input"
                rows={4}
                aria-label="Texto do modelo"
                placeholder="Oi {{1}}, tudo bem? …"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </Field>
            <div className="flex items-center gap-2 text-[11.5px] text-light-neutral-500">
              <button
                type="button"
                className="inline-flex items-center rounded-[6px] border border-light-accent-500 bg-transparent px-[10px] py-[3px] text-[11px] text-light-accent-300"
                onClick={() => setForm({ ...form, body: `${form.body}${form.body && !form.body.endsWith(' ') ? ' ' : ''}{{${nVars + 1}}}` })}
              >
                {`{{${nVars + 1}}}`}
              </button>
              Variáveis numeradas. {'{{1}}'} é o primeiro nome nos disparos.
            </div>
            {nVars > 0 &&
              Array.from({ length: nVars }, (_, i) => (
                <Field key={i} label={`Exemplo para {{${i + 1}}}`}>
                  <input
                    className="pc-input"
                    aria-label={`Exemplo da variável ${i + 1}`}
                    placeholder={i === 0 ? 'Ana' : ''}
                    value={form.examples[i] ?? ''}
                    onChange={(e) => {
                      const ex = [...form.examples]
                      ex[i] = e.target.value
                      setForm({ ...form, examples: ex })
                    }}
                  />
                </Field>
              ))}
            {errors.length > 0 && (
              <ul role="alert" className="flex flex-col gap-1 text-[12px] text-[#b0472f]">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button type="button" className="pc-btn pc-btn-primary !text-[12px] disabled:opacity-60" disabled={busy === 'submit'} onClick={() => void submit()}>
                <PaperPlaneTilt size={14} />
                {busy === 'submit' ? 'Enviando…' : 'Enviar para a Meta'}
              </button>
            </div>
          </div>
        )}

        {suggestions.map((s) => (
          <div key={s.name} className="rounded-md border border-dashed border-light-divider px-[14px] py-3">
            <div className="flex items-center gap-[6px]">
              <span className="font-mono text-[12.5px] font-medium">{s.name}</span>
              <Tag tone="outline" className="!px-[5px] !py-px !text-[9.5px]">Utilidade</Tag>
              <Tag tone="neutral" className="!px-[5px] !py-px !text-[9.5px]">Sugerido</Tag>
            </div>
            <div className="mt-1 text-[12px] text-light-neutral-500">{s.body}</div>
            <button
              type="button"
              className={cn(linkBtn, 'mt-2')}
              onClick={() => openForm({ name: s.name, cat: 'Utilidade', body: s.body, examples: s.examples })}
            >
              <Plus size={13} />
              Criar na Meta
            </button>
          </div>
        ))}

        {templates.map((t) => {
          const usable = templateUsable(t)
          const blockedReason = t.soLocal
            ? 'Este modelo existe só no PearChat. Envie-o para aprovação da Meta.'
            : t.status !== 'Aprovado'
              ? t.status === 'Rejeitado'
                ? 'A Meta não aprovou este modelo'
                : t.status === 'Em análise'
                  ? 'Aguarde a aprovação da Meta para usar'
                  : `Modelo ${t.status.toLowerCase()} pela Meta`
              : t.naoSuportado
                ? t.naoSuportado
                : (t.vars ?? 0) > 1
                  ? 'Disparos só preenchem {{1}} (o primeiro nome); este modelo tem mais variáveis'
                  : null
          return (
            <div key={t.id} className="flex flex-col gap-1.5">
              <RadioCard
                selected={tplSel === t.id}
                disabled={!usable}
                className="items-start"
                onClick={() => {
                  if (!usable) {
                    toast({ icon: <Clock size={18} weight="fill" />, title: t.soLocal ? 'Só no PearChat' : `Modelo ${t.status.toLowerCase()}`, text: blockedReason ?? '' })
                    return
                  }
                  setTplSel(t.id)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-[6px]">
                    <span className="font-mono text-[12.5px] font-medium">{t.nome}</span>
                    <Tag tone="outline" className="!px-[5px] !py-px !text-[9.5px]">{t.cat}</Tag>
                    {t.soLocal && <Tag tone="neutral" className="!px-[5px] !py-px !text-[9.5px]">Só no PearChat</Tag>}
                  </span>
                  <span className="mt-1 block text-[12px] text-light-neutral-500">{t.corpo}</span>
                  {t.status === 'Rejeitado' && t.motivo && <span className="mt-1 block text-[11.5px] text-[#b0472f]">Motivo: {t.motivo}</span>}
                  {t.status !== 'Rejeitado' && t.motivo && t.status !== 'Aprovado' && <span className="mt-1 block text-[11.5px] text-light-neutral-500">{t.motivo}</span>}
                </span>
                {!t.soLocal && (
                  <span className={cn('inline-flex flex-none items-center gap-1 text-[11px]', STATUS_STYLE[t.status])}>
                    {t.status === 'Aprovado' ? <CheckCircle size={12} weight="fill" /> : <Clock size={12} weight="fill" />}
                    {t.status}
                  </span>
                )}
              </RadioCard>
              <div className="flex items-center gap-3 pl-[30px] text-[11.5px]">
                {t.soLocal && (
                  <button type="button" className={linkBtn} onClick={() => openForm({ id: t.id, name: t.nome, cat: t.cat, body: t.corpo, examples: t.exemplos ?? [] })}>
                    <PaperPlaneTilt size={12} />
                    Enviar para aprovação
                  </button>
                )}
                {!usable && !t.soLocal && blockedReason && t.status === 'Aprovado' && <span className="text-light-neutral-500">{blockedReason}</span>}
                <span className="flex-1" />
                {confirmDel === t.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-light-neutral-500">{t.soLocal ? 'Excluir?' : 'Excluir também na Meta?'}</span>
                    <button type="button" className="border-0 bg-transparent p-0 text-[11.5px] text-[#b0472f] underline disabled:opacity-60" disabled={busy === t.id} onClick={() => void remove(t)}>
                      Excluir
                    </button>
                    <button type="button" className="border-0 bg-transparent p-0 text-[11.5px] text-light-neutral-500 underline" onClick={() => setConfirmDel(null)}>
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <button type="button" className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[11.5px] text-light-neutral-500 hover:underline" onClick={() => setConfirmDel(t.id)}>
                    <Trash size={12} />
                    Excluir
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {templates.length === 0 && suggestions.length === 0 && <div className="text-[12px] text-light-neutral-500">Nenhum modelo ainda. Use “Criar modelo”.</div>}

        <div className="rounded-md border border-light-divider bg-light-bg p-[14px]">
          <div className="mb-2 text-[11px] text-light-neutral-500">Prévia para Ana Paula Ribeiro</div>
          <ChatBubble>{selected ? previewTemplate(selected) : 'Escolha um modelo aprovado'}</ChatBubble>
        </div>
      </Section>
    </>
  )
}
