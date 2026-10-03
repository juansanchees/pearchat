import { Tag } from '@/components/pear'
import { cn } from '@/lib/utils'
import { formatLastContact, sigla } from './format'
import type { Contact } from './types'

export function ContactRow({
  contact,
  active,
  onSelect,
}: {
  contact: Contact
  active: boolean
  onSelect: (c: Contact) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(contact)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-light-divider px-4 py-3 text-left text-light-text',
        active
          ? 'bg-light-accent-900 shadow-[inset_3px_0_0_var(--light-accent-500)]'
          : 'bg-transparent hover:bg-light-neutral-900',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-[38px] w-[38px] flex-none place-items-center rounded-pill text-[12.5px] font-medium leading-none text-light-accent-200',
          active ? 'bg-light-accent-800' : 'bg-light-neutral-900',
        )}
      >
        {sigla(contact.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-[7px]">
          <span className="min-w-0 truncate text-[13.5px] font-medium leading-tight">{contact.name}</span>
          {contact.tags.map((t) => (
            <Tag key={t} className="flex-none whitespace-nowrap !text-[10px]">
              {t}
            </Tag>
          ))}
        </span>
        <span className="mt-[3px] block truncate text-xs text-light-neutral-500">{contact.phoneDisplay}</span>
      </span>
      <span className="flex-none whitespace-nowrap text-[11.5px] text-light-neutral-500">
        {formatLastContact(contact.lastContactAt)}
      </span>
    </button>
  )
}
