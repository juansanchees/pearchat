'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { fmtNum } from '@/components/app/automations'
import { Pill } from '@/components/pear'
import { PERIODOS } from '@/server/results/types'
import type { Periodo, ResultsDto } from '@/server/results/types'
import { api } from './api'
import { DrawerShell, ProgressBar, Section } from './parts'

const FAIXAS = [
  { nome: 'Madrugada', hint: '0h às 6h' },
  { nome: 'Manhã', hint: '6h às 12h' },
  { nome: 'Tarde', hint: '12h às 18h' },
  { nome: 'Noite', hint: '18h às 24h' },
]
// Segunda a domingo (o servidor devolve 0 = domingo).
const DIAS_SEMANA: { nome: string; dow: number }[] = [
  { nome: 'Seg', dow: 1 },
  { nome: 'Ter', dow: 2 },
  { nome: 'Qua', dow: 3 },
  { nome: 'Qui', dow: 4 },
  { nome: 'Sex', dow: 5 },
  { nome: 'Sáb', dow: 6 },
  { nome: 'Dom', dow: 0 },
]

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

/** "45 s", "3 min 20 s", "1 h 05 min". */
export function fmtDuracao(seg: number): string {
  if (seg < 60) return `${seg} s`
  const min = Math.floor(seg / 60)
  if (min < 10) return `${min} min${seg % 60 ? ` ${seg % 60} s` : ''}`
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, '0')} min`
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

/** Faixa de números (mesmo desenho dos três números do painel de contato). */
function Stats({ items, cols }: { items: { label: string; value: ReactNode }[]; cols?: string }) {
  return (
    <div className={`grid overflow-hidden rounded-md border border-solid border-light-divider ${cols ?? 'grid-cols-3'}`}>
      {items.map((s, i) => (
        <div key={s.label} className={i === 0 ? 'px-2 py-3 text-center' : 'border-0 border-l border-solid border-light-divider px-2 py-3 text-center'}>
          <div className="text-[15px] font-medium leading-none">{s.value}</div>
          <div className="mt-1 text-[10.5px] leading-[1.25] text-light-neutral-500">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

const Nota = ({ children }: { children: ReactNode }) => <div className="text-[11.5px] leading-[1.45] text-light-neutral-500">{children}</div>

/** Linha com rótulo, total e barra (mesmo estilo dos medidores do Plano). */
function Medidor({ label, total, pctBar }: { label: string; total: number; pctBar: number }) {
  return (
    <div>
      <div className="mb-[6px] flex items-center justify-between gap-3 text-[12px]">
        <span className="min-w-0 truncate" title={label}>
          {label}
        </span>
        <span className="flex-none text-light-neutral-500">{fmtNum(total)}</span>
      </div>
      <ProgressBar pct={pctBar} />
    </div>
  )
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Carregando resultados">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse flex-col gap-[10px]">
          <div className="h-[10px] w-[90px] rounded-pill bg-light-neutral-900" />
          <div className="h-[58px] rounded-md bg-light-neutral-900" />
          <div className="h-[56px] rounded-md bg-light-neutral-900" />
        </div>
      ))}
    </div>
  )
}

export function ResultadosDrawer() {
  const { closeDrawer } = useAppState()
  const [periodo, setPeriodo] = useState<Periodo>(30)
  const [data, setData] = useState<ResultsDto | null>(null)
  const [busy, setBusy] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  const carregar = useCallback(async (p: Periodo, alive: () => boolean) => {
    setBusy(true)
    setErro(null)
    try {
      const r = await api<ResultsDto>(`/api/results?period=${p}`)
      if (alive()) setData(r)
    } catch (e) {
      if (alive()) setErro(e instanceof Error ? e.message : 'Tente novamente em instantes.')
    } finally {
      if (alive()) setBusy(false)
    }
  }, [])

  useEffect(() => {
    let vivo = true
    void carregar(periodo, () => vivo)
    return () => {
      vivo = false
    }
  }, [periodo, tentativa, carregar])

  const footer = (
    <button type="button" className="pc-btn pc-btn-ghost" onClick={closeDrawer}>
      Fechar
    </button>
  )

  const pilulas = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período">
      {PERIODOS.map((p) => (
        <Pill key={p} active={periodo === p} onClick={() => setPeriodo(p)}>
          {p} dias
        </Pill>
      ))}
      {data && (
        <span className="ml-auto text-[11.5px] text-light-neutral-500">
          {dm(data.de)} a {dm(data.ate)}
        </span>
      )}
    </div>
  )

  if (!data && busy) {
    return (
      <DrawerShell id="resultados" footer={footer}>
        {pilulas}
        <Esqueleto />
      </DrawerShell>
    )
  }

  if (!data) {
    return (
      <DrawerShell id="resultados" footer={footer}>
        {pilulas}
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-light-divider p-6 text-center">
          <Warning size={22} className="text-light-neutral-500" />
          <div className="text-[13px] text-light-neutral-400">Não foi possível carregar os resultados.{erro ? ` ${erro}` : ''}</div>
          <button type="button" className="pc-btn pc-btn-secondary text-[12px]" onClick={() => setTentativa((t) => t + 1)}>
            Tentar de novo
          </button>
        </div>
      </DrawerShell>
    )
  }

  const d = data
  const maxDia = Math.max(1, ...d.atendimento.porDia.map((x) => x.recebidas))
  const maxPico = Math.max(1, ...d.picos.flat())
  const maxTipo = Math.max(1, ...d.agenda.porTipo.map((t) => t.total))
  const maxMotivo = Math.max(1, ...d.ia.passagensPorMotivo.map((m) => m.total))
  const semDados = <Nota>Ainda não há dados neste período.</Nota>

  return (
    <DrawerShell id="resultados" footer={footer}>
      {pilulas}
      {erro && (
        <div role="alert" className="rounded-md border border-light-divider px-3 py-2 text-[12px] text-light-neutral-400">
          Não foi possível atualizar agora. Mostrando os últimos números carregados.
        </div>
      )}
      <div className="flex flex-col gap-6 transition-opacity" style={{ opacity: busy ? 0.55 : 1 }} aria-busy={busy}>
        {d.vazio ? (
          <div className="rounded-md border border-dashed border-light-divider p-6 text-center text-[12.5px] text-light-neutral-500">
            Ainda não há dados neste período. Assim que houver conversas, agendamentos e disparos, os números aparecem aqui.
          </div>
        ) : null}

        <Section label="Atendimento">
          <Stats
            items={[
              { label: 'Conversas', value: fmtNum(d.atendimento.conversas) },
              { label: 'Recebidas', value: fmtNum(d.atendimento.recebidas) },
              { label: 'Enviadas', value: fmtNum(d.atendimento.enviadas) },
            ]}
          />
          <div className="flex items-center justify-between gap-3 rounded-md border border-solid border-light-divider px-[14px] py-3">
            <div className="min-w-0">
              <div className="text-[12.5px]">Tempo mediano até a 1ª resposta</div>
              <div className="mt-[3px] text-[11px] text-light-neutral-500">
                {d.atendimento.sessoesMedidas > 0
                  ? `${fmtNum(d.atendimento.sessoesMedidas)} ${d.atendimento.sessoesMedidas === 1 ? 'atendimento medido' : 'atendimentos medidos'}`
                  : 'Ainda não há dados neste período.'}
              </div>
            </div>
            <div className="flex-none text-[16px] font-medium">
              {d.atendimento.primeiraRespostaMedianaSeg === null ? '—' : fmtDuracao(d.atendimento.primeiraRespostaMedianaSeg)}
            </div>
          </div>
          <div>
            <div className="mb-[7px] flex items-center justify-between text-[11.5px] text-light-neutral-500">
              <span>Mensagens recebidas por dia</span>
              <span>máx. {fmtNum(maxDia)}</span>
            </div>
            <div
              role="img"
              aria-label={`Mensagens recebidas por dia, de ${dm(d.de)} a ${dm(d.ate)}: ${fmtNum(d.atendimento.recebidas)} no total`}
              className="flex h-[64px] items-end gap-[2px] rounded-md border border-solid border-light-divider px-2 pb-0 pt-2"
            >
              {d.atendimento.porDia.map((x) => (
                <div key={x.dia} title={`${dm(x.dia)}: ${x.recebidas}`} className="flex h-full min-w-0 flex-1 items-end">
                  <div
                    className="w-full rounded-t-[2px] bg-[linear-gradient(180deg,#7acc4a,#2e9a48)]"
                    style={{ height: x.recebidas === 0 ? 2 : `${Math.max(4, (x.recebidas / maxDia) * 100)}%`, opacity: x.recebidas === 0 ? 0.25 : 1 }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-[5px] flex justify-between text-[10.5px] text-light-neutral-500">
              <span>{dm(d.de)}</span>
              <span>{dm(d.ate)}</span>
            </div>
          </div>
        </Section>

        <Section label="Agente de IA">
          <Stats
            items={[
              { label: 'Respostas da IA', value: fmtNum(d.ia.respostas) },
              { label: 'Sem passar para você', value: pct(d.ia.semPassagemPct) },
              { label: 'Passagens para você', value: fmtNum(d.ia.passagens) },
            ]}
          />
          {d.ia.atendidas === 0 ? (
            semDados
          ) : (
            <Nota>
              {fmtNum(d.ia.atendidas)} {d.ia.atendidas === 1 ? 'conversa atendida' : 'conversas atendidas'} pela IA no período.
            </Nota>
          )}
          {d.ia.passagensPorMotivo.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-[11.5px] text-light-neutral-500">Passagens por motivo</div>
              {d.ia.passagensPorMotivo.map((m) => (
                <Medidor key={m.motivo} label={m.motivo} total={m.total} pctBar={(m.total / maxMotivo) * 100} />
              ))}
            </div>
          )}
        </Section>

        <Section label="Agenda">
          <Stats
            cols="grid-cols-4"
            items={[
              { label: 'Agendamentos', value: fmtNum(d.agenda.total) },
              { label: 'Pela IA', value: fmtNum(d.agenda.porOrigem.ia) },
              { label: 'Manuais', value: fmtNum(d.agenda.porOrigem.manual) },
              { label: 'Pelo link', value: fmtNum(d.agenda.porOrigem.link) },
            ]}
          />
          <Stats
            cols="grid-cols-3"
            items={[
              { label: 'Confirmados', value: fmtNum(d.agenda.confirmados) },
              { label: 'Pediram para remarcar', value: fmtNum(d.agenda.pediramRemarcar) },
              { label: 'Cancelados pelo cliente', value: fmtNum(d.agenda.canceladosPeloCliente) },
            ]}
          />
          {d.agenda.porTipo.length === 0 ? (
            semDados
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-[11.5px] text-light-neutral-500">Tipos de atendimento mais agendados</div>
              {d.agenda.porTipo.map((t) => (
                <Medidor key={t.tipo} label={t.tipo} total={t.total} pctBar={(t.total / maxTipo) * 100} />
              ))}
            </div>
          )}
          <Nota>Conta os agendamentos criados no período, não os que acontecem nele. Compromissos lidos do Google não entram.</Nota>
        </Section>

        <Section label="Disparos">
          <Stats
            cols="grid-cols-4"
            items={[
              { label: 'Campanhas', value: fmtNum(d.disparos.campanhas) },
              { label: 'Mensagens enviadas', value: fmtNum(d.disparos.enviadas) },
              { label: 'Respostas', value: fmtNum(d.disparos.respostas) },
              { label: 'Taxa de resposta', value: pct(d.disparos.taxaResposta) },
            ]}
          />
          {d.disparos.enviadas === 0 && semDados}
        </Section>

        <Section label="Follow-up">
          <Stats
            items={[
              { label: 'Follow-ups enviados', value: fmtNum(d.followup.enviados) },
              { label: 'Responderam em 48 h', value: fmtNum(d.followup.recuperados) },
              { label: 'Taxa de recuperação', value: pct(d.followup.taxaRecuperacao) },
            ]}
          />
          {d.followup.enviados === 0 ? (
            semDados
          ) : d.followup.aguardando > 0 ? (
            <Nota>
              {fmtNum(d.followup.aguardando)} {d.followup.aguardando === 1 ? 'envio ainda está' : 'envios ainda estão'} dentro das 48 h e {d.followup.aguardando === 1 ? 'fica' : 'ficam'} fora da taxa.
            </Nota>
          ) : null}
        </Section>

        <Section label="Horários de pico">
          <div className="overflow-hidden rounded-md border border-solid border-light-divider">
            <div className="grid grid-cols-[44px_repeat(4,minmax(0,1fr))] text-[10.5px] text-light-neutral-500">
              <div />
              {FAIXAS.map((f) => (
                <div key={f.nome} className="px-1 py-[7px] text-center" title={f.hint}>
                  {f.nome}
                </div>
              ))}
              {DIAS_SEMANA.map((dia) => (
                <div key={dia.dow} className="contents">
                  <div className="flex items-center border-0 border-t border-solid border-light-divider px-2 text-[11px]">{dia.nome}</div>
                  {FAIXAS.map((f, fi) => {
                    const v = d.picos[dia.dow][fi]
                    const r = v / maxPico
                    return (
                      <div
                        key={f.nome}
                        title={`${dia.nome}, ${f.nome.toLowerCase()} (${f.hint}): ${v} ${v === 1 ? 'mensagem recebida' : 'mensagens recebidas'}`}
                        className="grid h-[30px] place-items-center border-0 border-l border-t border-solid border-light-divider text-[10.5px]"
                        style={{
                          background: v === 0 ? 'transparent' : `color-mix(in srgb, #2e9a48 ${Math.round(12 + r * 70)}%, transparent)`,
                          color: r > 0.6 ? '#ffffff' : undefined,
                        }}
                      >
                        {v > 0 ? fmtNum(v) : ''}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <Nota>Mensagens recebidas por dia da semana e faixa do dia (horário de São Paulo). Quanto mais escuro, mais mensagens.</Nota>
        </Section>
      </div>
    </DrawerShell>
  )
}
