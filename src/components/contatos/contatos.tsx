'use client'

import { useCallback, useState } from 'react'
import { useAppState } from '@/components/app/app-state'
import { emitContactsChanged } from '@/components/app/events'
import { CloudCard } from './cloud-card'
import { ContactList } from './contact-list'
import { ContactPanel } from './contact-panel'
import { ContactsHeader } from './contacts-header'
import { NewContactCard } from './new-contact-card'
import type { NewContactInput } from './types'
import { useContactActions } from './use-contact-actions'
import { useContactIo } from './use-contact-io'
import { useContacts } from './use-contacts'
import { useContactToasts } from './toasts'
import { ApiError } from './api'

export default function Contatos(): JSX.Element {
  const { user } = useAppState()
  const c = useContacts()
  const toasts = useContactToasts()
  const actions = useContactActions(c.patchLocal)
  const [newOpen, setNewOpen] = useState(false)

  const { reload } = c
  const onImported = useCallback(() => reload(true), [reload])
  const io = useContactIo({ total: c.counts.todos, onImported })

  const { create, savePatch } = c
  const submitNew = useCallback(
    async (input: NewContactInput): Promise<boolean> => {
      if (!input.name) {
        toasts.missingName()
        return false
      }
      if (!input.phone) {
        toasts.missingPhone()
        return false
      }
      try {
        const created = await create(input)
        toasts.saved(created.name)
        emitContactsChanged()
        return true
      } catch (e) {
        toasts.error(
          e instanceof ApiError && e.status === 409 ? 'Telefone já cadastrado' : 'Não foi possível salvar',
          e instanceof Error ? e.message : 'Tente novamente em instantes',
        )
        return false
      }
    },
    [create, toasts],
  )

  const saveNotes = useCallback(
    async (id: string, notes: string, keepalive: boolean) => {
      await savePatch(id, { notes }, { keepalive })
    },
    [savePatch],
  )
  const onNotesError = useCallback(
    () => toasts.error('Não foi possível salvar', 'As anotações não foram salvas. Tente novamente.'),
    [toasts],
  )
  const retry = useCallback(() => reload(), [reload])

  return (
    <div className="flex h-full min-h-0 flex-col bg-light-bg text-light-text">
      <ContactsHeader
        total={c.counts.todos || c.total}
        importing={io.importing}
        onImport={io.pickFile}
        onNew={() => setNewOpen(true)}
      />
      <input
        ref={io.inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="Selecionar arquivo CSV para importar"
        onChange={(e) => void io.onFile(e)}
      />

      <div className="flex min-h-0 flex-1 animate-zfIn flex-wrap items-start gap-4 overflow-y-auto p-4">
        <ContactList
          items={c.items}
          total={c.total}
          counts={c.counts}
          status={c.status}
          query={c.query}
          onQuery={c.setQuery}
          filter={c.filter}
          onFilter={c.setFilter}
          selectedId={c.selected?.id ?? null}
          onSelect={c.select}
          hasMore={c.nextCursor !== null}
          loadingMore={c.loadingMore}
          onLoadMore={() =>
            void c.loadMore().catch(() => toasts.error('Não foi possível carregar mais', 'Tente novamente.'))
          }
          onRetry={retry}
          onImport={io.pickFile}
          onNew={() => setNewOpen(true)}
        />

        <div className="flex min-w-0 max-w-[420px] flex-[1_1_300px] flex-col gap-3.5">
          {newOpen ? <NewContactCard onClose={() => setNewOpen(false)} onSubmit={submitNew} /> : null}
          {c.selected ? (
            <ContactPanel
              contact={c.selected}
              opening={actions.opening}
              onChat={(ct) => void actions.chat(ct)}
              onSchedule={actions.schedule}
              saveNotes={saveNotes}
              onNotesSaved={(id, notes) => c.patchLocal(id, { notes })}
              onNotesError={onNotesError}
            />
          ) : null}
          <CloudCard company={user.empresa} exporting={io.exporting} onExport={() => void io.exportCsv()} />
        </div>
      </div>
    </div>
  )
}
