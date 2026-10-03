import { AddressBook, CloudCheck, UploadSimple, UserPlus } from '@phosphor-icons/react'
import { MenuButton } from '@/components/app/menu-button'
import { formatCount } from './format'

export function ContactsHeader({
  total,
  importing,
  onImport,
  onNew,
}: {
  total: number
  importing: boolean
  onImport: () => void
  onNew: () => void
}) {
  return (
    <div className="flex min-h-14 flex-none flex-wrap items-center gap-x-3.5 gap-y-2.5 border-0 border-b border-solid border-light-divider bg-light-surface px-5 py-2.5">
      <MenuButton />
      <span
        aria-hidden="true"
        className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[8px] border border-solid border-light-accent-700 bg-light-accent-900"
      >
        <AddressBook size={16} className="text-light-accent-300" />
      </span>
      <div className="min-w-0">
        <h1 className="m-0 text-[14.5px] font-medium leading-tight">Contatos</h1>
        <div className="whitespace-nowrap text-[11px] text-light-neutral-500">{formatCount(total)} {total === 1 ? 'contato' : 'contatos'}</div>
      </div>
      <span className="flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-solid border-light-accent-700 bg-light-accent-900 px-2.5 py-1 text-[11.5px] text-light-accent-200">
        <CloudCheck size={13} weight="fill" aria-hidden="true" />
        Na nuvem
      </span>
      <div className="flex-1" />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onImport}
          disabled={importing}
          className="pc-btn pc-btn-ghost whitespace-nowrap text-[12px]"
        >
          <UploadSimple size={14} aria-hidden="true" />
          {importing ? 'Importando…' : 'Importar'}
        </button>
        <button type="button" onClick={onNew} className="pc-btn pc-btn-primary whitespace-nowrap text-[12px]">
          <UserPlus size={14} aria-hidden="true" />
          Novo contato
        </button>
      </div>
    </div>
  )
}
