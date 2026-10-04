import { planPrice } from '@/lib/plans'
import { Faq } from './sections/faq'
import { Features } from './sections/features'
import { FinalCta } from './sections/final-cta'
import { Hero } from './sections/hero'
import { HowItWorks, Impact, Niches, RevealObserver } from './lazy'
import { Pricing } from './sections/pricing'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

// Página inicial pública. Server Component; só três ilhas de cliente pequenas (Como funciona, Para quem é e
// Vários WhatsApps). Ritmo: claro (herói) → escuro (impacto) → claro (funcionalidades) → escuro (como funciona)
// → claro (nichos, planos, dúvidas) → verde/preto (chamada final).
export function Landing() {
  return (
    <div className="lp-root min-h-screen overflow-x-clip bg-light-bg text-light-text">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow-md"
      >
        Ir para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo">
        <Hero />
        <Impact />
        <Features />
        <HowItWorks />
        <Niches />
        <Pricing />
        <Faq essencial={planPrice('ESSENCIAL').toLocaleString('pt-BR')} />
        <FinalCta />
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  )
}
