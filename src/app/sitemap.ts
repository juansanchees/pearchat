import type { MetadataRoute } from 'next'

const base = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || 'https://pearchat.online').replace(/\/+$/, '')

// Só as páginas públicas (as telas do app exigem login).
export default function sitemap(): MetadataRoute.Sitemap {
  const b = base()
  return [
    { url: `${b}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${b}/privacidade`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${b}/termos`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
