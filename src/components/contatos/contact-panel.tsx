'use client'

import { Cake, CalendarPlus, Envelope, MapPin, WhatsappLogo } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Tag } from '@/components/pear'
import { ContactNotes } from './contact-notes'
import { formatBRL, formatBirthday, formatSince, NONE, sigla } from './format'
import { PhotoLayer } from '@/components/conversas/contact-avatar'
import type { Contact } from './types'

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-[11px]">
      <span className="mt-px text-light-neutral-500" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10.5px] text-light-neutral-500">{label}</div>
        <div className="mt-0.5 break-words text-[12.5px] [text-wrap:pretty]">{value}</div>
      </div>
    </div>
  )
}

export function ContactPanel({
  contact,
  opening,
  onChat,
  onSchedule,
  saveNotes,
  onNotesSaved,
  onNotesError,
}: {
  contact: Contact
  opening: boolean
  onChat: (c: Contact) => void
  onSchedule: (c: Contact) => void
  saveNotes: (id: string, notes: string, keepalive: boolean) => Promise<void>
  onNotesSaved: (id: string, notes: string) => void
  onNotesError: () => void
}) {
  const stats = [
    { label: 'Pedidos', value: String(contact.orders) },
    { label: 'Total gasto', value: formatBRL(contact.totalSpent) },
    { label: 'Cliente desde', value: formatSince(contact.customerSince) },
  ]

  return (
    <section
      aria-label={`Contato ${contact.name}`}
      className="flex-none overflow-hidden rounded-lg border border-solid border-light-divider bg-light-surface shadow-md"
    >
      <div className="flex flex-col items-center gap-2.5 bg-gradient-to-b from-light-accent-900 to-light-surface px-[18px] pb-[18px] pt-[22px] text-center">
        <span
          aria-hidden="true"
          className="relative grid h-16 w-16 place-items-center rounded-pill border-[3px] border-solid border-light-surface bg-light-accent-800 text-[20px] font-medium leading-none text-light-accent-200 shadow-[0_0_0_1px_var(--light-accent-700)]"
        >
          {sigla(contact.name)}
          <PhotoLayer src={contact.photoUrl} />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 break-words text-base font-medium leading-tight">{contact.name}</h2>
          <div className="mt-[3px] text-xs text-light-neutral-500">{contact.phoneDisplay}</div>
        </div>
        {contact.tags.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-[5px]">
            {contact.tags.map((t) => (
              <Tag key={t} className="!text-[10.5px]">
                {t}
              </Tag>
            ))}
          </div>
        ) : null}
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => onChat(contact)}
            disabled={opening}
            className="pc-btn pc-btn-primary text-[12px]"
          >
            <WhatsappLogo size={14} aria-hidden="true" />
            Conversar
          </button>
          <button type="button" onClick={() => onSchedule(contact)} className="pc-btn pc-btn-secondary text-[12px]">
            <CalendarPlus size={14} aria-hidden="true" />
            Agendar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-0 border-y border-solid border-light-divider">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={
              i === 0
                ? 'px-2 py-3 text-center'
                : 'border-0 border-l border-solid border-light-divider px-2 py-3 text-center'
            }
          >
            <div className="text-[15px] font-medium leading-none">{s.value}</div>
            <div className="mt-1 text-[10.5px] text-light-neutral-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-[18px] py-4">
        <Info icon={<Envelope size={15} />} label="E-mail" value={contact.email || NONE} />
        <Info icon={<MapPin size={15} />} label="Endereço de entrega" value={contact.address || NONE} />
        <Info icon={<Cake size={15} />} label="Aniversário" value={formatBirthday(contact.birthday)} />
        <ContactNotes
          key={contact.id}
          contactId={contact.id}
          initial={contact.notes}
          save={saveNotes}
          onSaved={onNotesSaved}
          onError={onNotesError}
        />
      </div>
    </section>
  )
}
