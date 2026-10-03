'use client'

import { useState } from 'react'
import { CalendarCheck, CheckCircle, Clock, PaperPlaneTilt, Plus, UploadSimple } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { fmtNum } from '@/components/app/automations'
import { PearSwitch, Tag } from '@/components/pear'
import { cn } from '@/lib/utils'
import type { CampaignDTO, DisparosSettingsDTO, TemplateDTO } from '@/lib/types'
import { api } from './api'
import { toTemplate, useDrawerData, useDrawerLoad } from './drawer-data'
import { INTERVALOS, INTERVALO_API } from './mock-data'
import { toCampanha, formatDt } from './view'
import { ChatBubble, DrawerShell, Field, ProgressBar, RadioCard, Section, Seg } from './parts'

const QUANDO = ['Agora', 'Agendar'] as const
const VARS = ['{primeiro_nome}', '{nome}']

const linkBtn = 'inline-flex items-center gap-1 bg-transparent p-0 text-[12px] text-light-accent-300 hover:underline'

export function DisparosDrawer() {
  const { wa, connected, automations, setAutomation, toast } = useAppState()
  const { disp, setDisp, listas, campanhas, setCampanhas, templates, setTemplates, tplSel, setTplSel, silencio, setSilencio, failToast } = useDrawerData()
  const loading = useDrawerLoad('disparos')
  const [sending, setSending] = useState(false)
  const oficial = wa.provider === 'oficial'
  const lista = listas.find((l) => l.id === disp.lista) ?? listas.find((l) => l.id === 'clientes')
  const tpl = templates.find((t) => t.id === tplSel)

  const previewRapida = disp.msg.trim()
    ? disp.msg.replaceAll('{primeiro_nome}', 'Ana').replaceAll('{nome}', 'Ana Paula Ribeiro')
    : 'Escreva a mensagem acima'
  const previewOficial = tpl ? tpl.corpo.replace('{{1}}', 'Ana') : ''

  const addVar = (v: string) => setDisp((d) => ({ ...d, msg: d.msg + (d.msg.endsWith(' ') || d.msg === '' ? '' : ' ') + v }))

  const criarModelo = async () => {
    const corpo = disp.msg.replaceAll('{primeiro_nome}', '{{1}}').replaceAll('{nome}', '{{1}}')
    try {
      const novo = await api<TemplateDTO>('/api/templates', { method: 'POST', body: { category: 'MARKETING', body: corpo } })
      setTemplates((l) => [...l, toTemplate(novo)])
      toast({ icon: <Clock size={18} weight="fill" />, title: 'Modelo enviado para a Meta', text: `${novo.name} · em análise` })
    } catch (e) {
      failToast('Não foi possível criar o modelo', e)
    }
  }

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
    if (oficial && !tpl) return
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
        ...(agendar ? { data: new Date(disp.data).toISOString() } : {}),
        intervalo: INTERVALO_API[disp.intervalo] ?? '15-30',
      }
      const r = await api<{ campaign: CampaignDTO }>('/api/campaigns', { method: 'POST', body })
      if (!automations.disparos) void setAutomation('disparos', true)
      const nova = toCampanha(r.campaign)
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
        <Section
          label="Modelo aprovado"
          gap="gap-3"
          aside={
            <button type="button" className={linkBtn} onClick={() => void criarModelo()}>
              <Plus size={13} />
              Criar modelo
            </button>
          }
        >
          <div className="text-[12px] text-light-neutral-400">
            No WhatsApp oficial, disparos usam modelos aprovados pela Meta. A aprovação costuma levar alguns minutos.
          </div>
          {templates.map((t) => {
            const analise = t.status !== 'Aprovado'
            return (
              <RadioCard
                key={t.id}
                selected={tplSel === t.id}
                disabled={analise}
                className="items-start"
                onClick={() => {
                  if (analise) {
                    toast({
                      icon: <Clock size={18} weight="fill" />,
                      title: t.status === 'Rejeitado' ? 'Modelo rejeitado' : 'Modelo em análise',
                      text: t.status === 'Rejeitado' ? 'A Meta não aprovou este modelo' : 'Aguarde a aprovação da Meta para usar',
                    })
                    return
                  }
                  setTplSel(t.id)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-[6px]">
                    <span className="font-mono text-[12.5px] font-medium">{t.nome}</span>
                    <Tag tone="outline" className="!px-[5px] !py-px !text-[9.5px]">{t.cat}</Tag>
                  </span>
                  <span className="mt-1 block text-[12px] text-light-neutral-500">{t.corpo}</span>
                </span>
                <span className={cn('inline-flex flex-none items-center gap-1 text-[11px]', analise ? 'text-[#b0872f]' : 'text-light-accent-300')}>
                  {analise ? <Clock size={12} weight="fill" /> : <CheckCircle size={12} weight="fill" />}
                  {t.status}
                </span>
              </RadioCard>
            )
          })}
          <div className="rounded-md border border-light-divider bg-light-bg p-[14px]">
            <div className="mb-2 text-[11px] text-light-neutral-500">Prévia para Ana Paula Ribeiro</div>
            <ChatBubble>{previewOficial}</ChatBubble>
          </div>
        </Section>
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
