import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PearChat',
    short_name: 'PearChat',
    description: 'Conecte o WhatsApp, atenda clientes e ligue automações.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f7ef',
    theme_color: '#f6f7ef',
    icons: [
      { src: '/brand/pearchat-avatar-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
