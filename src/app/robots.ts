import type { MetadataRoute } from 'next'

const base = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://pearchat.online').replace(/\/+$/, '')

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacidade', '/termos'],
        disallow: [
          '/api/',
          '/a/',
          '/whatsapp',
          '/agenda',
          '/contatos',
          '/login',
          '/registro',
          '/recuperar-senha',
          '/redefinir-senha',
          '/verificar-email',
          '/verificar-acesso',
          '/sessao-encerrada',
          '/bem-vindo',
        ],
      },
    ],
    sitemap: `${base()}/sitemap.xml`,
  }
}
