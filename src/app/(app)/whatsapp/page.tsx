import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Spinner } from '@/components/pear'
import { WhatsAppView } from '@/components/whatsapp/whatsapp-view'

export const metadata: Metadata = { title: 'PearChat · Conversas' }

export default function WhatsAppPage() {
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center bg-light-bg">
          <Spinner />
        </div>
      }
    >
      <WhatsAppView />
    </Suspense>
  )
}
