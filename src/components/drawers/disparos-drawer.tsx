'use client'

import { useState } from 'react'
import { CalendarCheck, PaperPlaneTilt, UploadSimple } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { fmtNum } from '@/components/app/automations'
import { PearSwitch, Tag } from '@/components/pear'
import type { CampaignDTO, DisparosSettingsDTO } from '@/lib/types'
import { api } from './api'
import { templateUsable, useDrawerData, useDrawerLoad } from './drawer-data'
import { OficialTemplates } from './disparos-templates'
import { INTERVALOS, INTERVALO_API } from './mock-data'
import { toCampanha, formatDt } from './view'
import { zonedToInstant } from '@/lib/timezone'
import { ChatBubble, DrawerShell, Field, ProgressBar, RadioCard, Section, Seg } from './parts'

const QUANDO = ['Agora', 'Agendar'] as const
const VARS = ['{primeiro_nome}', '{nome}']

/** Valor do datetime-local ("2026-10-08T10:00") no fuso `tz` -> ISO UTC; texto inválido segue cru (o servidor recusa). */
function dataAgendadaIso(v: string, tz: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v)
  return m ? zonedToInstant(m[1], m[2], tz).toISOString() : v
}

const linkBtn = 'inline-flex items-center gap-1 bg-transparent p-0 text-[12px] text-light-accent-300 hover:underline'

export function DisparosDrawer() {
  const { wa, connected, automations, setAutomation, toast, locale } = useAppState()
  const { disp, setDisp, listas, campanhas, setCampanhas, templates, setTemplates, tplSel, setTplSel, silencio, setSilencio, failToast } = useDrawerData()
  const loading = useDrawerLoad('disparos')
  const [sending, setSending] = useState(false)
  const oficial = wa.provider === 'oficial'
  const lista = listas.find((l) => l.id === disp.lista) ?? listas.find((l) => l.id === 'clientes')
  const tpl = templates.find((t) => t.id === tplSel)

  const previewRapida = disp.msg.trim()
    ? disp.msg.replaceAll('{primeiro_nome}', 'Ana').replaceAll('{nome}', 'Ana Paula Ribeiro')
    : 'Escreva a mensagem acima'

  const addVar = (v: string) => setDisp((d) => ({ ...d, msg: d.msg + (d.msg.endsWith(' ') || d.msg === '' ? '' : ' ') + v }))

  const HORAS = Array.from({ length: 24 }, (_, h) => h)
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  // Salva na hora (otimista); volta ao valor anterior se o servidor recusar.
  const salvarSilencio = async (patch: Partial<DisparosSettingsDTO>) => {
    const antes = silencio
    const novo = { ...silencio, ...patch }
    if (novo.silencioInicio === novo.silencioFim) {
      failToast('Horário inválido', new Error('Início e fim do silêncio devem ser horas diferentes.'))
      return
    }
    setSilencio(novo)
    try {
      setSilencio(await api<DisparosSettingsDTO>('/api/campaigns/settings', { method: 'PUT', body: novo }))
    } catch (e) {
      setSilencio(antes)
      failToast('Não foi possível salvar o horário de silêncio', e)
    }
  }

  const iniciar = async () => {
    if (sending) return
    if (!oficial && !disp.msg.trim()) return
    if (oficial && (!tpl || !templateUsable(tpl))) {
      toast({ icon: <PaperPlaneTilt size={18} weight="fill" />, title: 'Escolha um modelo aprovado', text: 'Disparos oficiais só usam modelos aprovados pela Meta' })
      return
    }
    if (!connected) {
      toast({
        icon: <PaperPlaneTilt size={18} weight="fill" />,
        title: 'Conecte o WhatsApp primeiro',
        text: 'Depois disso você pode ligar Disparos automáticos',
      })
      return
    }
    const agendar = disp.quando === 'Agendar'
    setSending(true)
    try {
      const body = {
        lista: disp.lista,
        ...(oficial ? { templateId: tplSel } : { mensagem: disp.msg.trim() }),
        quando: agendar ? 'agendar' : 'agora',
        // "Data e hora" é do relógio do espaço (o mesmo do horário de silêncio), não do navegador.
        ...(agendar ? { data: dataAgendadaIso(disp.data, locale.timezone) } : {}),
        intervalo: INTERVALO_API[disp.intervalo] ?? '15-30',
      }
      const r = await api<{ campaign: CampaignDTO }>('/api/campaigns', { method: 'POST', body })
      if (!automations.disparos) void setAutomation('disparos', true)
      const nova = toCampanha(r.campaign, locale.timezone)
      setCampanhas((l) => [nova, ...l])
      toast(
        agendar
          ? { icon: <CalendarCheck size={18} weight="fill" />, title: 'Disparo agendado', text: `${nova.lista} · ${formatDt(disp.data)}` }
          : { icon: <PaperPlaneTilt size={18} weight="fill" />, title: 'Disparo iniciado', text: `${fmtNum(nova.total)} ${nova.total === 1 ? 'contato' : 'contatos'} · ${nova.lista}` },
      )
    } catch (e) {
      failToast('Não foi possível criar o disparo', e)
    } finally {
      setSending(false)
    }
  }

  const footer = (
    <>
      <span className="flex-1 text-[12px] text-light-neutral-500">
        {lista ? `${fmtNum(lista.qtd)} ${lista.qtd === 1 ? 'contato' : 'contatos'} · ${lista.nome}` : ''}
      </span>
      <button type="button" className="pc-btn pc-btn-primary disabled:opacity-60" disabled={sending} onClick={() => void iniciar()}>
        <PaperPlaneTilt size={14} />
        {disp.quando === 'Agendar' ? 'Agendar disparo' : 'Iniciar disparo'}
      </button>
    </>
  )

  return (
    <DrawerShell id="disparos" loading={loading} footer={footer}>
      <Section
        label="Para quem enviar"
        aside={
          <button
            type="button"
            className={linkBtn}
            onClick={() => toast({ icon: <UploadSimple size={18} weight="fill" />, title: 'Importar lista', text: 'Envie um arquivo CSV com nome e telefone' })}
          >
            <UploadSimple size={13} />
            Importar lista
          </button>
        }
      >
        {listas.map((l) => (
          <RadioCard key={l.id} selected={disp.lista === l.id} onClick={() => setDisp((d) => ({ ...d, lista: l.id }))}>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-[1.25]">{l.nome}</span>
              <span className="block text-[11.5px] text-light-neutral-500">{l.desc}</span>
            </span>
            <span className="flex-none text-[13px] font-medium leading-none text-light-neutral-400">{fmtNum(l.qtd)}</span>
          </RadioCard>
        ))}
      </Section>

      {!oficial ? (
        <Section label="Mensagem" gap="gap-3">
          <textarea
            className="pc-input"
            rows={4}
            aria-label="Mensagem"
            value={disp.msg}
            onChange={(e) => setDisp((d) => ({ ...d, msg: e.target.value }))}
          />
          <div className="flex items-center gap-2 text-[11.5px] text-light-neutral-500">
            Inserir:
            {VARS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => addVar(v)}
                className="inline-flex items-center rounded-[6px] border border-light-accent-500 bg-transparent px-[10px] py-[3px] text-[11px] tracking-[0.02em] text-light-accent-300"
              >
                {v}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-light-divider bg-light-bg p-[14px]">
            <div className="mb-2 text-[11px] text-light-neutral-500">Prévia para Ana Paula Ribeiro</div>
            <ChatBubble>{previewRapida}</ChatBubble>
          </div>
        </Section>
      ) : (
        <OficialTemplates templates={templates} setTemplates={setTemplates} tplSel={tplSel} setTplSel={setTplSel} />
      )}

      <Section label="Envio" gap="gap-3">
        <div className="flex flex-wrap gap-[14px]">
          <Field label="Quando enviar" className="min-w-0 flex-[1_1_200px]">
            <Seg options={QUANDO} value={disp.quando} onChange={(v) => setDisp((d) => ({ ...d, quando: v }))} label="Quando enviar" />
          </Field>
          <Field label="Intervalo entre mensagens" className="min-w-0 flex-[1_1_220px]">
            <Seg options={INTERVALOS} value={disp.intervalo} onChange={(v) => setDisp((d) => ({ ...d, intervalo: v }))} label="Intervalo entre mensagens" />
          </Field>
        </div>
        {disp.quando === 'Agendar' && (
          <Field label="Data e hora">
            <input
              className="pc-input"
              type="datetime-local"
              value={disp.data}
              onChange={(e) => setDisp((d) => ({ ...d, data: e.target.value }))}
            />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <PearSwitch size="sm" checked={silencio.silencioAtivo} label="Horário de silêncio" onChange={(on) => void salvarSilencio({ silencioAtivo: on })} />
          <span>Não enviar entre</span>
          <select
            className="pc-input !w-auto"
            aria-label="Início do silêncio"
            disabled={!silencio.silencioAtivo}
            value={silencio.silencioInicio}
            onChange={(e) => void salvarSilencio({ silencioInicio: Number(e.target.value) })}
          >
            {HORAS.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
          <span>e</span>
          <select
            className="pc-input !w-auto"
            aria-label="Fim do silêncio"
            disabled={!silencio.silencioAtivo}
            value={silencio.silencioFim}
            onChange={(e) => void salvarSilencio({ silencioFim: Number(e.target.value) })}
          >
            {HORAS.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[11.5px] text-light-neutral-500">Evita mensagens de madrugada, que incomodam o cliente e aumentam o risco de bloqueio do número.</div>
        <div className="text-[11.5px] text-light-neutral-500">
          {oficial
            ? 'Cada mensagem de marketing é cobrada pela Meta conforme a tarifa do Brasil.'
            : 'Intervalos maiores deixam o envio mais natural e reduzem o risco de bloqueio do número.'}
        </div>
      </Section>

      <Section label="Campanhas">
        {campanhas.map((c) => (
          <div key={c.id} className="animate-zfIn rounded-md border border-light-divider px-[14px] py-[13px]">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-[1.25]">{c.lista}</div>
                <div className="text-[11px] text-light-neutral-500">{c.data}</div>
              </div>
              <Tag tone={c.status === 'Concluída' ? 'neutral' : 'accent'} className="!text-[10.5px]">
                {c.retida ? 'Aguardando horário permitido' : c.status}
              </Tag>
            </div>
            <div className="my-[10px]">
              <ProgressBar pct={c.total > 0 ? Math.round((c.enviadas / c.total) * 100) : 0} />
            </div>
            <div className="flex gap-4 text-[11.5px] text-light-neutral-400">
              <span>
                {fmtNum(c.enviadas)}/{fmtNum(c.total)} enviadas
              </span>
              <span>{fmtNum(c.respostas)} respostas</span>
            </div>
          </div>
        ))}
      </Section>
    </DrawerShell>
  )
}
