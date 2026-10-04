'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowSquareOut, CreditCard, CrownSimple, DownloadSimple, MetaLogo } from '@phosphor-icons/react'
import { api } from './api'
import { cobrancaLabels, faturaStatus, fmtDia, FORMAS, openInvoice } from './plano-cobranca'
import type { Forma } from './plano-cobranca'
import { useAppState } from '@/components/app/app-state'
import { fmtNum } from '@/components/app/automations'
import { Tag } from '@/components/pear'
import { cn } from '@/lib/utils'
import { useDrawerData, useDrawerLoad } from './drawer-data'
import { PLANOS, PLANO_RANK } from './mock-data'
import { DrawerShell, ProgressBar, Section } from './parts'
import { fmtBRL } from './view'

export function PlanoDrawer() {
  const { wa, toast, closeDrawer, spaces } = useAppState()
  const { plano, billing, loadDrawer } = useDrawerData()
  const loading = useDrawerLoad('plano')
  // Cobrança (Asaas): só existe com BILLING_ENABLED=true; sem isso nada abaixo aparece e o drawer fica como era.
  const cob = billing?.cobranca
  const [forma, setForma] = useState<Forma>('PIX')
  const [doc, setDoc] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const assinante = !!cob && (cob.status === 'ativa' || cob.status === 'atrasada')
  const rotulos = cob ? cobrancaLabels(cob) : null
  const precoDe = (nome: string, fallback: string) => (cob?.precos[nome] ? `R$ ${cob.precos[nome].toLocaleString('pt-BR')}/mês` : fallback)

  const chamar = async (url: string, body: unknown, ok: (r: { invoiceUrl?: string | null; tipo?: string; plano?: string }) => void) => {
    setBusy(true)
    setErro(null)
    try {
      ok(await api(url, { method: 'POST', body }))
      await loadDrawer('plano')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Tente novamente em instantes.')
    } finally {
      setBusy(false)
    }
  }
  const escolher = (nome: string) =>
    chamar('/api/billing/checkout', { plano: nome, forma, cpfCnpj: doc || undefined }, (r) => {
      if (r.tipo === 'downgrade') toast({ icon: <CrownSimple size={18} weight="fill" />, title: 'Mudança agendada', text: 'O novo plano vale a partir da próxima cobrança' })
      else if (r.tipo === 'downgrade_cancelado') toast({ icon: <CrownSimple size={18} weight="fill" />, title: 'Mudança cancelada', text: 'Você continua no plano atual' })
      else if (openInvoice(r.invoiceUrl)) toast({ icon: <CreditCard size={18} weight="fill" />, title: 'Fatura aberta em nova aba', text: 'O plano vale assim que o pagamento for confirmado' })
      else toast({ icon: <CreditCard size={18} weight="fill" />, title: 'Fatura sendo gerada', text: 'Ela aparece em Pagamento em instantes' })
    })
  const svcUsed = billing?.uso.mensagensAtendimento ?? 0
  const emBreve = (texto: string, icon: ReactNode = <CrownSimple size={18} weight="fill" />) => toast({ icon, title: 'Em breve', text: texto })

  // Renovação mensal: dia 1 do mês seguinte (ainda sem gateway de cobrança).
  const renova = (() => {
    const d = new Date()
    return `01/${String(((d.getMonth() + 1) % 12) + 1).padStart(2, '0')}`
  })()

  const limiteTxt = (n: number, limite: number | null) => (limite === null ? `${fmtNum(n)} · ilimitado` : `${fmtNum(n)} de ${fmtNum(limite)}`)
  const usoMes = billing
    ? [
        { label: 'Respostas da IA', n: billing.uso.respostasIa, limite: billing.limites.respostasIa },
        { label: 'Disparos', n: billing.uso.disparos, limite: billing.limites.disparos },
        { label: 'Contatos', n: billing.uso.contatos, limite: billing.limites.contatos },
      ].map((u) => ({ label: u.label, txt: limiteTxt(u.n, u.limite), pct: u.limite ? Math.min(100, Math.round((u.n / u.limite) * 100)) : 0 }))
    : []
  // WhatsApps (espaços) da conta: "N de M". Antes do billing carregar usa a lista do menu lateral.
  const espacos = billing?.espacos ?? { usados: spaces.espacos.length, limite: spaces.limite }
  // Transcrição de áudio: minutos somados da organização no mês (sem limite por plano por enquanto).
  if (billing) usoMes.push({ label: 'Transcrição de áudio', txt: `${fmtNum(Math.ceil(billing.uso.transcricoesSeg / 60))} min`, pct: 0 })
  if (billing?.pessoas) usoMes.push({ label: 'Pessoas', txt: `${billing.pessoas.usados} de ${billing.pessoas.limite}`, pct: Math.min(100, Math.round((billing.pessoas.usados / Math.max(1, billing.pessoas.limite)) * 100)) })
  usoMes.push({ label: 'WhatsApps', txt: `${espacos.usados} de ${espacos.limite}`, pct: Math.min(100, Math.round((espacos.usados / Math.max(1, espacos.limite)) * 100)) })
  const faturas = billing?.faturas ?? []
  const atual = PLANOS.find((p) => p.nome === plano) ?? PLANOS[1]

  const footer = (
    <button type="button" className="pc-btn pc-btn-ghost" onClick={closeDrawer}>
      Fechar
    </button>
  )

  return (
    <DrawerShell id="plano" loading={loading} footer={footer}>
      <div className="flex flex-col gap-[14px] rounded-lg border border-light-accent-700 bg-light-accent-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11.5px] text-light-accent-300">
              Seu plano
              {rotulos && <Tag tone={cob?.status === 'ativa' || cob?.status === 'isenta' ? 'accent' : 'neutral'} className="!px-2 !text-[10px]">{rotulos.etiqueta}</Tag>}
            </div>
            <div className="mt-[3px] text-[20px] font-medium leading-[1.2]">{atual.nome}</div>
          </div>
          <div className="text-right">
            <div className="text-[16px] font-medium leading-[1.2]">{precoDe(atual.nome, atual.preco)}</div>
            <div className="text-[11px] text-light-neutral-500">{rotulos ? rotulos.linha : `Renova em ${renova}`}</div>
          </div>
        </div>

        {wa.provider === 'oficial' && (
          <div className="rounded-md border border-light-accent-700 bg-light-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
              <span className="inline-flex items-center gap-[6px]">
                <MetaLogo size={14} className="text-light-accent-300" />
                Mensagens de atendimento (Meta)
              </span>
              <span className="text-light-neutral-500">{fmtNum(svcUsed)} de 1.000 grátis</span>
            </div>
            <ProgressBar pct={Math.min(100, Math.round(svcUsed / 10))} />
            <div className="mt-[7px] text-[11px] text-light-neutral-500">
              1.000 grátis por mês neste número. Depois disso a Meta cobra por resposta enviada, inclusive as da IA.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {usoMes.map((u) => (
            <div key={u.label}>
              <div className="mb-[6px] flex items-center justify-between text-[12px]">
                <span>{u.label}</span>
                <span className="text-light-neutral-500">{u.txt}</span>
              </div>
              <div className="h-[6px] rounded-pill bg-light-surface">
                <div className="h-full rounded-pill bg-[linear-gradient(90deg,#7acc4a,#2e9a48)]" style={{ width: `${u.pct}%` }} />
              </div>
            </div>
          ))}
          {espacos.usados >= espacos.limite && (
            <div className="text-[11.5px] text-light-neutral-500">
              Seu plano permite {espacos.limite} {espacos.limite === 1 ? 'WhatsApp' : 'WhatsApps'}. Faça upgrade para adicionar mais números.
            </div>
          )}
        </div>
      </div>

      <Section label="Planos">
        {PLANOS.map((p) => {
          const cur = p.nome === plano
          const rank = PLANO_RANK[p.nome]
          const curRank = PLANO_RANK[plano]
          return (
            <div
              key={p.nome}
              className={cn('flex items-center gap-[14px] rounded-md border p-[14px]', cur ? 'border-light-accent-600' : 'border-light-divider')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium leading-[1.2]">{p.nome}</span>
                  <span className="text-[12.5px] text-light-accent-300">{precoDe(p.nome, p.preco)}</span>
                </div>
                <div className="mt-1 text-[11.5px] text-light-neutral-500">{p.desc}</div>
              </div>
              {cob && cob.status !== 'isenta' ? (
                <button
                  type="button"
                  disabled={busy || cob.status === 'cancelada' && !!cob.proximaCobranca && new Date(cob.proximaCobranca) > new Date() || (assinante && cur && !cob.planoAgendado) || cob.planoAgendado === p.nome}
                  className={cn('pc-btn whitespace-nowrap !text-[12px]', !assinante || rank > curRank ? 'pc-btn-primary' : cur ? 'pc-btn-ghost' : 'pc-btn-secondary')}
                  onClick={() => void escolher(p.nome)}
                >
                  {cob.planoAgendado === p.nome ? 'Agendado' : !assinante ? (cob.planoPendente === p.nome ? 'Pagar' : 'Assinar') : cur ? (cob.planoAgendado ? 'Manter este' : 'Plano atual') : rank > curRank ? 'Fazer upgrade' : 'Mudar'}
                </button>
              ) : (
                <button
                  type="button"
                  className={cn('pc-btn whitespace-nowrap !text-[12px]', cur ? 'pc-btn-ghost' : rank > curRank ? 'pc-btn-primary' : 'pc-btn-secondary')}
                  onClick={() => {
                    if (cur) return
                    emBreve(cob ? 'Sua conta é isenta de cobrança' : 'A troca de plano estará disponível em breve')
                  }}
                >
                  {cur ? 'Plano atual' : rank > curRank ? 'Fazer upgrade' : 'Mudar'}
                </button>
              )}
            </div>
          )
        })}
      </Section>

      <Section label="Pagamento">
        {cob && cob.status !== 'isenta' && (
          <div className="flex flex-col gap-[10px]">
            <div className="pc-seg" role="group" aria-label="Forma de pagamento">
              {FORMAS.map((f) => (
                <button key={f.id} type="button" className="pc-seg-opt" aria-pressed={forma === f.id} onClick={() => setForma(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            {cob.documento ? (
              <div className="text-[12px] text-light-neutral-500">Documento do pagador cadastrado: {cob.documento}</div>
            ) : (
              <input
                className="pc-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="CPF ou CNPJ do pagador"
                aria-label="CPF ou CNPJ do pagador"
                value={doc}
                onChange={(e) => setDoc(e.target.value.slice(0, 18))}
              />
            )}
            <div className="text-[11.5px] text-light-neutral-500">O pagamento acontece na página segura do Asaas. O PearChat não recebe nem guarda dados de cartão.</div>
            {erro && (
              <div role="alert" className="text-[12px] text-amber-text">
                {erro}
              </div>
            )}
            {cob.status === 'cancelada' && cob.proximaCobranca && new Date(cob.proximaCobranca) > new Date() && (
              <button type="button" disabled={busy} className="pc-btn pc-btn-primary self-start !text-[12px]" onClick={() => void chamar('/api/billing/reactivate', { forma }, () => toast({ icon: <CrownSimple size={18} weight="fill" />, title: 'Assinatura reativada', text: `Próxima cobrança em ${fmtDia(cob.proximaCobranca!)}` }))}>
                Reativar assinatura
              </button>
            )}
            {cob.temAssinatura &&
              (confirmCancel ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-light-divider px-3 py-[10px] text-[12px]">
                  <span className="flex-1">
                    Cancelar a assinatura?
                    {cob.proximaCobranca && new Date(cob.proximaCobranca) > new Date() ? ` Você mantém o acesso até ${fmtDia(cob.proximaCobranca)}.` : ''}
                  </span>
                  <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setConfirmCancel(false)}>
                    Voltar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="pc-btn pc-btn-secondary !text-[12px]"
                    onClick={() => void chamar('/api/billing/cancel', {}, () => { setConfirmCancel(false); toast({ icon: <CrownSimple size={18} weight="fill" />, title: 'Assinatura cancelada', text: 'Seus dados continuam guardados' }) })}
                  >
                    Confirmar cancelamento
                  </button>
                </div>
              ) : (
                <button type="button" className="pc-btn pc-btn-ghost self-start !text-[12px]" onClick={() => setConfirmCancel(true)}>
                  Cancelar assinatura
                </button>
              ))}
          </div>
        )}
        {!cob && (
        <div className="flex items-center gap-3 rounded-md border border-light-divider px-[14px] py-3">
          <CreditCard size={18} className="flex-none text-light-accent-300" />
          <span className="flex-1 text-[12.5px]">Nenhum cartão cadastrado</span>
          <button
            type="button"
            className="pc-btn pc-btn-ghost !text-[12px]"
            onClick={() => emBreve('A troca de cartão estará disponível em breve', <CreditCard size={18} weight="fill" />)}
          >
            Trocar
          </button>
        </div>
        )}
        {cob && (
          <div className="overflow-hidden rounded-md border border-light-divider">
            {cob.faturas.length === 0 && <div className="px-[14px] py-[12px] text-[12.5px] text-light-neutral-500">Nenhuma fatura ainda.</div>}
            {cob.faturas.map((f, i) => (
              <div key={f.id} className={cn('flex items-center gap-3 px-[14px] py-[10px] text-[12.5px]', i > 0 && 'border-t border-light-divider')}>
                <span className="flex-1">{f.vencimento ? fmtDia(f.vencimento) : '—'}</span>
                <span className="text-light-neutral-500">{fmtBRL(f.valor)}</span>
                <Tag tone="neutral" className="!px-2 !text-[10px]">{faturaStatus(f.status)}</Tag>
                <button
                  type="button"
                  title="Abrir fatura"
                  aria-label="Abrir fatura"
                  disabled={!f.invoiceUrl}
                  className="pc-btn pc-btn-ghost h-7 w-7 !p-0"
                  onClick={() => void openInvoice(f.invoiceUrl)}
                >
                  <ArrowSquareOut size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {!cob && (
        <div className="overflow-hidden rounded-md border border-light-divider">
          {faturas.length === 0 && <div className="px-[14px] py-[12px] text-[12.5px] text-light-neutral-500">Nenhuma fatura ainda.</div>}
          {faturas.map((f, i) => (
            <div key={f.id} className={cn('flex items-center gap-3 px-[14px] py-[10px] text-[12.5px]', i > 0 && 'border-t border-light-divider')}>
              <span className="flex-1">{f.mes}</span>
              <span className="text-light-neutral-500">{fmtBRL(f.valor)}</span>
              <Tag tone="neutral" className="!px-2 !text-[10px]">{/^pag/i.test(f.status) || f.status === 'paid' ? 'Pago' : f.status.charAt(0).toUpperCase() + f.status.slice(1)}</Tag>
              <button
                type="button"
                title="Baixar"
                aria-label={`Baixar fatura de ${f.mes}`}
                className="pc-btn pc-btn-ghost h-7 w-7 !p-0"
                onClick={() => {
                  if (f.pdfUrl?.startsWith('https://')) window.open(f.pdfUrl, '_blank', 'noopener,noreferrer')
                  else emBreve('O PDF desta fatura ainda não está disponível', <DownloadSimple size={18} weight="fill" />)
                }}
              >
                <DownloadSimple size={14} />
              </button>
            </div>
          ))}
        </div>
        )}
      </Section>
    </DrawerShell>
  )
}
