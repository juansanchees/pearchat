import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

const TITLE = 'PearChat'
const DESCRIPTION = 'Conecte o WhatsApp, atenda clientes e ligue automações.'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://pearchat.online'),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: TITLE,
    locale: 'pt_BR',
    title: 'PearChat · WhatsApp com atendimento por IA',
    description: 'Conecte o WhatsApp, deixe a IA responder do seu jeito e acompanhe atendimento, disparos e agenda em uma tela só.',
    images: [{ url: '/brand/pearchat-avatar-1024.png', width: 1024, height: 1024, alt: 'PearChat' }],
  },
  twitter: {
    card: 'summary',
    title: 'PearChat · WhatsApp com atendimento por IA',
    description: DESCRIPTION,
    images: ['/brand/pearchat-avatar-1024.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#f6f7ef',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans`}>{children}</body>
    </html>
  )
}
