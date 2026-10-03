'use client'

import { AddressBook, MagnifyingGlass, UploadSimple, UserPlus, WarningCircle } from '@phosphor-icons/react'
import { Spinner } from '@/components/pear'
import { cn } from '@/lib/utils'
import { ContactRow } from './contact-row'
import { formatCount } from './format'
import type { Contact, ContactCounts, ContactFilter } from './types'
import type { ListStatus } from './use-contacts'

const FILTERS: { key: ContactFilter; label: string; count: (c: ContactCounts) => number }[] = [
  { key: 'todos', label: 'Todos', count: (c) => c.todos },
  { key: 'cliente', label: 'Clientes', count: (c) => c.clientes },
  { key: 'lead', label: 'Leads', count: (c) => c.leads },
  { key: 'vip', label: 'VIP', count: (c) => c.vip },
]

export function ContactList({
  items,
  total,
  counts,
  status,
  query,
  onQuery,
  filter,
  onFilter,
  selectedId,
  onSelect,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onImport,
  onNew,
}: {
  items: Contact[]
  total: number
  counts: ContactCounts
  status: ListStatus
  query: string
  onQuery: (q: string) => void
  filter: ContactFilter
  onFilter: (f: ContactFilter) => void
  selectedId: string | null
  onSelect: (c: Contact) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onImport: () => void
  onNew: () => void
}) {
  const filtering = query.trim() !== '' || filter !== 'todos'

  return (
    <section
      aria-label="Lista de contatos"
      className="flex min-w-0 flex-[999_1_380px] flex-col overflow-hidden rounded-lg border border-solid border-light-divider bg-light-surface shadow-md"
    >
      <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-light-divider px-4 py-3.5">
        <div className="relative min-w-0 flex-[1_1_220px]">
          <MagnifyingGlass
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-[11px] top-1/2 -translate-y-1/2 text-light-neutral-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar por nome, telefone ou etiqueta"
            aria-label="Buscar contatos"
            className="pc-input !pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-solid px-[11px] py-[5px] text-xs',
                filter === f.key
                  ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
                  : 'border-light-divider bg-transparent text-light-neutral-400 hover:border-light-neutral-700',
              )}
            >
              {f.label}
              <span className="text-[10.5px] text-light-neutral-500">{formatCount(f.count(counts))}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        {status === 'loading' ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : status === 'error' ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <WarningCircle size={32} className="text-light-neutral-600" aria-hidden="true" />
            <p className="m-0 text-[13.5px] font-medium">Não foi possível carregar os contatos</p>
            <button type="button" onClick={onRetry} className="pc-btn pc-btn-secondary mt-1 text-[12px]">
              Tentar de novo
            </button>
          </div>
        ) : items.length === 0 && !filtering ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <AddressBook size={32} className="text-light-neutral-600" aria-hidden="true" />
            <p className="m-0 text-[13.5px] font-medium">Nenhum contato ainda</p>
            <p className="m-0 max-w-[320px] text-xs leading-relaxed text-light-neutral-500">
              Importe um CSV ou crie o primeiro contato para começar.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onImport} className="pc-btn pc-btn-secondary text-[12px]">
                <UploadSimple size={14} aria-hidden="true" />
                Importar
              </button>
              <button type="button" onClick={onNew} className="pc-btn pc-btn-primary text-[12px]">
                <UserPlus size={14} aria-hidden="true" />
                Novo contato
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12.5px] text-light-neutral-500">Nenhum contato encontrado.</div>
        ) : (
          items.map((c) => <ContactRow key={c.id} contact={c} active={c.id === selectedId} onSelect={onSelect} />)
        )}
      </div>

      {status === 'ready' && items.length > 0 ? (
        <div className="flex items-center border-0 border-t border-solid border-light-divider px-4 py-2.5 text-[11.5px] text-light-neutral-500">
          <span className="flex-1">
            Mostrando {formatCount(items.length)} de {formatCount(total)}
          </span>
          {hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-light-accent-300 hover:underline disabled:cursor-default disabled:opacity-60"
            >
              {loadingMore ? 'Carregando…' : 'Carregar mais'}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
