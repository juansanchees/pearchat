import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Agenda } from '@/components/agenda/agenda'
import { Spinner } from '@/components/pear'

export const metadata: Metadata = { title: 'PearChat · Agenda' }

export default function AgendaPage() {
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center bg-light-bg">
          <Spinner />
        </div>
      }
    >
      <Agenda />
    </Suspense>
  )
}
