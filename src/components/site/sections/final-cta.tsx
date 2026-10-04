import Link from 'next/link'
import { ArrowRight } from '@/components/site/ui/icons'
import { PearGlass } from '@/components/brand/pear-glass'
import { btnPro, wrap } from '../ui/styles'

export function FinalCta() {
  return (
    <section aria-labelledby="t-final" style={{ containIntrinsicSize: 'auto 900px' }} className="lp-cv relative overflow-hidden bg-[#050807] text-dark-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(45% 70% at 78% 55%, rgba(46,154,72,.45), transparent 70%), radial-gradient(40% 60% at 10% 100%, rgba(30,74,46,.6), transparent 70%), linear-gradient(180deg, #050807 0%, #0a1a10 100%)',
        }}
      />
      <div className={`${wrap} relative grid grid-cols-1 items-center gap-10 py-24 min-[900px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-[768px]:py-32`}>
        <div>
          <h2 id="t-final" className="max-w-[12ch] text-balance text-[44px] font-semibold leading-[0.98] tracking-[-0.045em] text-white min-[768px]:text-[72px] min-[1200px]:text-[84px]">
            Seu WhatsApp trabalhando <span className="text-dark-accent-400">por você.</span>
          </h2>
          <p className="mt-6 max-w-[44ch] text-[17px] leading-[1.6] text-dark-neutral-300 min-[768px]:text-[19px]">
            Crie a conta, conecte o número e ensine a IA. O resto, o PearChat faz junto com você.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href="/registro" className={btnPro}>
              Começar grátis <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
            <Link href="/login" className="rounded-md text-[15px] font-medium text-dark-neutral-200 underline-offset-4 hover:text-white hover:underline">
              Já tenho conta
            </Link>
          </div>
          <p className="mt-5 text-[13px] text-dark-neutral-500">Sem cartão de crédito. Durante o lançamento, o uso é gratuito.</p>
        </div>
        <div className="relative mx-auto w-[min(340px,70vw)]">
          <span aria-hidden="true" className="absolute inset-[-20%] rounded-pill bg-[radial-gradient(circle,rgba(92,203,110,.35),transparent_65%)] blur-2xl" />
          <PearGlass id="pg-final" tone="dark" className="relative w-full rotate-[6deg]" />
        </div>
      </div>
    </section>
  )
}
