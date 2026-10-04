'use client'

import type { ReactNode } from 'react'
import { CreditCard, CrownSimple, DownloadSimple, MetaLogo } from '@phosphor-icons/react'
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
  const { plano, billing } = useDrawerData()
  const loading = useDrawerLoad('plano')
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
            <div className="text-[11.5px] text-light-accent-300">Seu plano</div>
            <div className="mt-[3px] text-[20px] font-medium leading-[1.2]">{atual.nome}</div>
          </div>
          <div className="text-right">
            <div className="text-[16px] font-medium leading-[1.2]">{atual.preco}</div>
            <div className="text-[11px] text-light-neutral-500">Renova em {renova}</div>
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
                  <span className="text-[12.5px] text-light-accent-300">{p.preco}</span>
                </div>
                <div className="mt-1 text-[11.5px] text-light-neutral-500">{p.desc}</div>
              </div>
              <button
                type="button"
                className={cn('pc-btn whitespace-nowrap !text-[12px]', cur ? 'pc-btn-ghost' : rank > curRank ? 'pc-btn-primary' : 'pc-btn-secondary')}
                onClick={() => {
                  if (cur) return
                  emBreve('A troca de plano estará disponível em breve')
                }}
              >
                {cur ? 'Plano atual' : rank > curRank ? 'Fazer upgrade' : 'Mudar'}
              </button>
            </div>
          )
        })}
      </Section>

      <Section label="Pagamento">
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
      </Section>
    </DrawerShell>
  )
}
