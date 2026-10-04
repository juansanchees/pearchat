import type { Metadata } from 'next'
import { Landing } from '@/components/site/landing'

// Página inicial pública (estática). Quem está logado nunca chega aqui: o middleware envia para /whatsapp.
const TITLE = 'PearChat · Seu WhatsApp atendendo, agendando e vendendo por você'
const DESCRIPTION =
  'Conecte o WhatsApp do seu negócio, ensine o agente de IA e acompanhe conversas, agenda, follow-up e disparos em uma tela só.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'PearChat',
    locale: 'pt_BR',
    url: '/',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/brand/pearchat-avatar-1024.png', width: 1024, height: 1024, alt: 'PearChat' }],
  },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION, images: ['/brand/pearchat-avatar-1024.png'] },
}

const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://pearchat.online').replace(/\/+$/, '')

// Dados estruturados simples (sem avaliações, preços inventados ou números de clientes).
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PearChat',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: baseUrl,
  description: DESCRIPTION,
  inLanguage: 'pt-BR',
  publisher: { '@type': 'Organization', name: 'INFODREAMZ NEGOCIOS DIGITAIS LTDA', url: baseUrl },
}

export default function SitePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Landing />
    </>
  )
}
