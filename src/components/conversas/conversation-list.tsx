'use client'

import { ArrowClockwise, ChatCircleDots, MagnifyingGlass, Warning } from '@phosphor-icons/react'
import { Spinner } from '@/components/pear'
import { cn } from '@/lib/utils'
import { ConversationItem } from './conversation-item'
import type { ConversationFilter, ConversationItem as Item } from './types'

const FILTERS: { key: ConversationFilter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'nao_lidas', label: 'Não lidas' },
  { key: 'com_ia', label: 'Com IA' },
]

// Clientes fictícios (spec 05) para simular mensagens com WA_MOCK.
const MOCK_CLIENTS = [
  { nome: 'Ana Paula Ribeiro', telefone: '+5511998124471', body: 'Oi! Vocês fazem bolo de pote para festa?' },
  { nome: 'Carlos Menezes', telefone: '+5511982205567', body: 'Boa tarde. Qual o valor do bolo de 2 kg de ninho com morango?' },
  { nome: 'Juliana Freitas', telefone: '+5511977442210', body: 'Vocês entregam no Tatuapé?' },
  { nome: 'Fernanda Lopes', telefone: '+5511966338812', body: 'Consigo pagar no Pix?' },
  { nome: 'Beatriz Sousa', telefone: '+5511981107742', body: 'Oi! Vi o cardápio de vocês no Instagram.' },
]

async function simulateInbound() {
  const c = MOCK_CLIENTS[Math.floor(Math.random() * MOCK_CLIENTS.length)]
  await fetch('/api/dev/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  }).catch(() => {})
}

export function ConversationList({
  items,
  total,
  loading,
  error,
  onRetry,
  filter,
  onFilter,
  query,
  onQuery,
  activeId,
  onSelect,
  iaOn,
  agentName,
  history,
}: {
  items: Item[]
  total: number
  loading: boolean
  error: boolean
  onRetry: () => void
  filter: ConversationFilter
  onFilter: (f: ConversationFilter) => void
  query: string
  onQuery: (q: string) => void
  activeId: string | null
  onSelect: (id: string) => void
  iaOn: boolean
  agentName: string
  history: { canImport: boolean; importing: boolean; syncing: boolean; failed: boolean; start: () => Promise<void> }
}) {
  const mock = process.env.NEXT_PUBLIC_WA_MOCK === 'true'

  return (
    <div className="flex min-h-0 flex-col border-0 border-r border-solid border-light-divider bg-light-surface">
      <div className="flex flex-col gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <div className="relative">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-light-neutral-500"
          />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar conversa"
            aria-label="Buscar conversa"
            className="min-h-9 w-full rounded-md border border-solid border-light-divider bg-light-surface py-1.5 pl-8 pr-2.5 text-sm text-light-text caret-light-accent-500 hover:border-light-neutral-500 focus-visible:border-light-accent-500 focus-visible:outline-none"
          />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                'whitespace-nowrap rounded-pill border border-solid px-[11px] py-[5px] text-xs',
                filter === f.key
                  ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
                  : 'border-light-divider bg-transparent text-light-neutral-400',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {history.importing && total > 0 ? (
        <div
          className="mx-3.5 mb-2 flex items-center gap-2 rounded-md bg-light-accent-900 px-3 py-2 text-xs text-light-accent-200"
          role="status"
        >
          <Spinner size={14} />
          Importando suas conversas do WhatsApp…
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10 text-light-accent-400">
            <Spinner size={20} />
          </div>
        ) : error && total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Warning size={28} className="text-light-neutral-500" />
            <p className="text-[13.5px] font-medium">Não foi possível carregar as conversas</p>
            <button type="button" onClick={onRetry} className="pc-btn pc-btn-secondary mt-1 text-[12px]">
              <ArrowClockwise size={13} /> Tentar de novo
            </button>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <ChatCircleDots size={32} className="text-light-neutral-600" />
            {history.importing || history.syncing ? (
              <>
                <Spinner size={22} />
                <p className="text-[13.5px] font-medium" role="status">
                  Importando suas conversas do WhatsApp…
                </p>
                <p className="text-xs leading-relaxed text-light-neutral-500">
                  Trazemos as conversas recentes do seu WhatsApp. Grupos não são importados.
                </p>
              </>
            ) : (
              <>
                <p className="text-[13.5px] font-medium">Nenhuma conversa ainda</p>
                <p className="text-xs leading-relaxed text-light-neutral-500">
                  Quando um cliente escrever para o seu WhatsApp, a conversa aparece aqui.
                </p>
                {history.canImport ? (
                  <>
                    <p className="text-xs leading-relaxed text-light-neutral-500">
                      Trazemos as conversas recentes do seu WhatsApp. Grupos não são importados.
                    </p>
                    {history.failed ? (
                      <p className="text-xs text-light-neutral-500">A última importação não terminou. Tente de novo.</p>
                    ) : null}
                    <button type="button" onClick={() => void history.start()} className="pc-btn pc-btn-secondary mt-1 text-[12px]">
                      Importar conversas anteriores
                    </button>
                  </>
                ) : null}
              </>
            )}
            {mock ? (
              <button
                type="button"
                onClick={() => void simulateInbound()}
                className="mt-2 rounded-md border border-solid border-light-divider px-3 py-1.5 text-xs text-light-neutral-400 hover:bg-[rgba(29,33,23,.07)]"
              >
                Simular mensagem de cliente
              </button>
            ) : null}
          </div>
        ) : (
          items.map((item) => (
            <ConversationItem
              key={item.id}
              item={item}
              active={item.id === activeId}
              iaOn={iaOn}
              agentName={agentName}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}
