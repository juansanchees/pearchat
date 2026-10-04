'use client'

import { useState } from 'react'
import { Flask, Plus, ShieldCheck, Sparkle, Trash } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { PearSwitch, Pill } from '@/components/pear'
import type { AgentDTO, AgentTestResultDTO, KnowledgeItemDTO } from '@/lib/types'
import { api } from './api'
import { toKbItem, useDrawerData, useDrawerLoad } from './drawer-data'
import { HANDOFF_OPCOES } from './mock-data'
import type { Horario, Idioma, KbItem, Tom } from './mock-data'
import { DrawerShell, Field, SaveFooter, Section, Seg } from './parts'
import { PendingAiSection } from './pending-ai-section'

const TONS: Tom[] = ['Amigável', 'Profissional', 'Direto']
const HORARIOS: Horario[] = ['Sempre', 'Fora do expediente', 'Só fins de semana']
const IDIOMAS: { id: Idioma; label: string }[] = [
  { id: 'auto', label: 'Automático' },
  { id: 'pt', label: 'Português' },
  { id: 'en', label: 'Inglês' },
  { id: 'es', label: 'Espanhol' },
]

export function IaDrawer() {
  const { setAgentName } = useAppState()
  const { agente, setAgente, kb, setKb, handoff, setHandoff, failToast } = useDrawerData()
  const loading = useDrawerLoad('ia')
  const [kbP, setKbP] = useState('')
  const [kbR, setKbR] = useState('')
  const [addingKb, setAddingKb] = useState(false)
  const [testQ, setTestQ] = useState('')
  const [testA, setTestA] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const edit = (patch: Partial<typeof agente>) => {
    setAgente((a) => ({ ...a, ...patch }))
    setTestA(null)
  }

  const addKb = async () => {
    const p = kbP.trim()
    const r = kbR.trim()
    if (!p || !r || addingKb) return
    setAddingKb(true)
    try {
      const novo = await api<KnowledgeItemDTO>('/api/agent/knowledge', { method: 'POST', body: { pergunta: p, resposta: r } })
      setKb((l) => [...l, toKbItem(novo)])
      setKbP('')
      setKbR('')
    } catch (e) {
      failToast('Não foi possível adicionar', e)
    } finally {
      setAddingKb(false)
    }
  }

  const removeKb = async (item: KbItem) => {
    const antes = kb
    setKb((l) => l.filter((k) => k.id !== item.id))
    try {
      await api(`/api/agent/knowledge/${item.id}`, { method: 'DELETE' })
    } catch (e) {
      setKb(antes)
      failToast('Não foi possível remover', e)
    }
  }

  const testar = async () => {
    const mensagem = testQ.trim()
    if (!mensagem || testing) return
    setTesting(true)
    try {
      // Envia o que está na tela (ainda não salvo) para o teste refletir as edições.
      const r = await api<AgentTestResultDTO>('/api/agent/test', {
        method: 'POST',
        body: { mensagem, nome: agente.nome.trim() || undefined, tom: agente.tom, prompt: agente.prompt, handoffRules: handoff, canSchedule: agente.canSchedule, idioma: agente.idioma },
      })
      setTestA(r.resposta)
    } catch (e) {
      failToast('Não foi possível testar', e)
    } finally {
      setTesting(false)
    }
  }

  const salvar = async () => {
    const saved = await api<AgentDTO>('/api/agent', {
      method: 'PUT',
      body: { nome: agente.nome, tom: agente.tom, prompt: agente.prompt, horario: agente.horario, handoffRules: handoff, canSchedule: agente.canSchedule, idioma: agente.idioma },
    })
    setAgentName(saved.nome)
  }

  return (
    <DrawerShell id="ia" loading={loading} footer={<SaveFooter titulo="Agentes de IA" onSave={salvar} />}>
      <PendingAiSection />
      <Section label="Identidade" gap="gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Nome do agente" className="min-w-0 flex-[1_1_160px]">
            <input
              className="pc-input"
              value={agente.nome}
              onChange={(e) => edit({ nome: e.target.value })}
            />
          </Field>
          <Field label="Tom de voz" className="min-w-0 flex-[1_1_220px]">
            <Seg options={TONS} value={agente.tom} onChange={(v) => edit({ tom: v })} label="Tom de voz" />
          </Field>
        </div>
      </Section>

      <Section label="Idioma das respostas" gap="gap-3">
        <Seg
          options={IDIOMAS.map((i) => i.label)}
          value={IDIOMAS.find((i) => i.id === agente.idioma)?.label ?? 'Automático'}
          onChange={(v) => edit({ idioma: IDIOMAS.find((i) => i.label === v)?.id ?? 'auto' })}
          label="Idioma das respostas"
        />
        <div className="text-[12px] text-light-neutral-400">Automático — responde no idioma do cliente. Escolha um idioma para o agente responder sempre nele.</div>
      </Section>

      <Section label="Instruções" gap="gap-3">
        <div className="text-[12px] text-light-neutral-400">Explique quem é o agente, como ele fala e o que ele pode ou não fazer.</div>
        <div className="pc-note flex gap-[9px]">
          <ShieldCheck size={15} className="mt-px flex-none text-light-accent-300" />
          <span>Por regra do WhatsApp, o agente só fala sobre o seu negócio. Assuntos fora disso recebem uma resposta educada de que ele não pode ajudar.</span>
        </div>
        <textarea
          className="pc-input w-full resize-y leading-[1.5]"
          rows={6}
          aria-label="Instruções do agente"
          value={agente.prompt}
          onChange={(e) => edit({ prompt: e.target.value })}
        />
      </Section>

      <Section label="O que ele precisa saber" aside={<span className="text-[11px] text-light-neutral-500">{kb.length} respostas</span>}>
        {kb.map((k) => (
          <div key={k.id} className="flex items-start gap-[10px] rounded-md border border-light-divider px-3 py-[11px]">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium leading-[1.3]">{k.p}</div>
              <div className="mt-1 text-[12px] text-light-neutral-400">{k.r}</div>
            </div>
            <button
              type="button"
              title="Remover"
              aria-label="Remover"
              className="pc-btn pc-btn-ghost h-7 w-7 flex-none !p-0"
              onClick={() => void removeKb(k)}
            >
              <Trash size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-light-neutral-700 p-3">
          <input
            className="pc-input"
            placeholder="Pergunta do cliente (ex.: Qual o horário de atendimento?)"
            value={kbP}
            onChange={(e) => setKbP(e.target.value)}
          />
          <input className="pc-input" placeholder="Como o agente deve responder" value={kbR} onChange={(e) => setKbR(e.target.value)} />
          <button type="button" className="pc-btn pc-btn-secondary self-start" onClick={() => void addKb()}>
            <Plus size={14} />
            Adicionar resposta
          </button>
        </div>
      </Section>

      <Section label="Passar para você quando">
        <div className="flex flex-wrap gap-2">
          {HANDOFF_OPCOES.map((o) => (
            <Pill
              key={o}
              variant="chip"
              active={handoff.includes(o)}
              onClick={() => setHandoff((l) => (l.includes(o) ? l.filter((x) => x !== o) : [...l, o]))}
            >
              {o}
            </Pill>
          ))}
        </div>
      </Section>

      <Section label="Quando responder">
        <Seg options={HORARIOS} value={agente.horario} onChange={(v) => edit({ horario: v })} label="Quando responder" />
      </Section>

      <Section label="Agenda">
        <div className="flex items-start gap-3 rounded-md border border-light-divider px-3 py-[11px]">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium leading-[1.3]">Permitir que o agente agende, remarque e cancele</div>
            <div className="mt-1 text-[12px] text-light-neutral-400">
              Ele consulta os horários livres da sua Agenda, confirma o dia e a hora com o cliente e só então marca. Só mexe nos horários do cliente da própria conversa. Desligado, a equipe confirma os horários.
            </div>
          </div>
          <PearSwitch checked={agente.canSchedule} onChange={(v) => edit({ canSchedule: v })} label="Permitir que o agente agende, remarque e cancele" />
        </div>
      </Section>

      <div className="flex flex-col gap-[10px] rounded-lg border border-light-divider bg-light-bg p-4">
        <div className="flex items-center gap-[6px] text-[13px] font-medium leading-[1.2]">
          <Flask size={15} className="text-light-accent-300" />
          Testar o agente
        </div>
        <div className="flex gap-2">
          <input
            className="pc-input"
            placeholder="Escreva como um cliente escreveria…"
            value={testQ}
            onChange={(e) => setTestQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void testar()
            }}
          />
          <button type="button" className="pc-btn pc-btn-primary disabled:opacity-60" disabled={testing} onClick={() => void testar()}>
            Testar
          </button>
        </div>
        {testA && (
          <div className="max-w-[88%] animate-zfIn self-end rounded-[14px_14px_4px_14px] border border-light-accent-700 bg-light-accent-900 px-[13px] py-[9px]">
            <div className="mb-1 flex items-center gap-[5px] text-[11px] text-light-accent-300">
              <Sparkle size={11} weight="fill" />
              {agente.nome} · IA
            </div>
            <div className="text-[13px] leading-[1.45]">{testA}</div>
          </div>
        )}
      </div>
    </DrawerShell>
  )
}
