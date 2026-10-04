import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BookingFlow } from '@/components/booking/booking-flow'
import { getPublicWorkspace } from '@/server/booking/public'

// Página pública (sem login) do link de agendamento. Link inexistente e link desativado são idênticos: 404 amigável.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const ws = await getPublicWorkspace(params.slug)
  return {
    title: ws ? `${ws.nome} · Agende seu horário` : 'Agendamento',
    description: ws ? `Agende um horário com ${ws.nome}.` : undefined,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title: ws ? `${ws.nome} · Agende seu horário` : 'Agendamento' },
  }
}

export default async function PublicBookingPage({ params }: { params: { slug: string } }) {
  const ws = await getPublicWorkspace(params.slug)
  if (!ws) notFound()
  return <BookingFlow slug={params.slug} negocio={ws.nome} />
}
