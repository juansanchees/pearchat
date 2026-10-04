'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LazyMotion, m, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { CalendarCheck } from '@phosphor-icons/react/dist/ssr'
import { PearGlass } from '@/components/brand/pear-glass'
import { cn } from '@/lib/utils'
import { useStepper } from '../anim/use-play'
import { HERO_FINAL, HeroAgenda, HeroAgent, HeroChat, HeroContacts } from '../mini/hero-windows'

// Palco do herói (ilha cliente). A mini-história roda em laço (useStepper) e as camadas respondem ao mouse
// (parallax por profundidade, amortecido por mola; desligado em telas de toque) e ao scroll (o conjunto "deita").
// Recursos de animação do motion são carregados depois, sob demanda.
const loadFeatures = () => import('../anim/motion-features').then((r) => r.default)

/** Quanto tempo (ms) cada passo da história fica na tela; o último é a pausa antes de recomeçar. */
const DURATIONS = [700, 1500, 1300, 1900, 1300, 1200, 1900, 1100, 5200]

function NewBookingToast({ show, className }: { show: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[12px] border border-light-divider bg-white/95 px-3.5 py-3 text-left text-light-text shadow-[0_2px_6px_rgba(29,33,23,.06),0_24px_48px_-16px_rgba(29,33,23,.4)] backdrop-blur transition-[opacity,transform] duration-500 ease-out',
        show ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
        className,
      )}
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-light-accent-fill text-white">
        <CalendarCheck size={18} weight="bold" />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight">Novo agendamento</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-light-neutral-500">Rafael Costa · amanhã, 16:00</span>
      </span>
    </div>
  )
}

/** Camada do palco: posição/profundidade fixas no CSS 3D e um deslocamento de parallax proporcional à profundidade. */
function Layer({
  box,
  depth,
  mx,
  my,
  children,
  className,
}: {
  box: { left: number; top: number; width: number; transform: string }
  depth: number
  mx: MotionValue<number>
  my: MotionValue<number>
  children: ReactNode
  className?: string
}) {
  const x = useTransform(mx, (v) => v * depth * 16)
  const y = useTransform(my, (v) => v * depth * 10)
  return (
    <div className="lp-layer" style={{ left: box.left, top: box.top, width: box.width, transform: box.transform }}>
      <m.div style={{ x, y }} className={className}>
        {children}
      </m.div>
    </div>
  )
}

export function HeroStage() {
  const { ref, step, fading } = useStepper<HTMLDivElement>({ durations: DURATIONS, final: HERO_FINAL, initial: 1 })
  const created = step >= HERO_FINAL
  const sectionRef = useRef<HTMLDivElement>(null)

  // Mouse: -1..1, amortecido. Só em dispositivos com ponteiro fino e com movimento permitido.
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const mx = useSpring(rawX, { stiffness: 60, damping: 18, mass: 0.6 })
  const my = useSpring(rawY, { stiffness: 60, damping: 18, mass: 0.6 })
  const [fine, setFine] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
    const on = () => setFine(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    if (!fine) {
      rawX.set(0)
      rawY.set(0)
      return
    }
    const move = (e: PointerEvent) => {
      rawX.set((e.clientX / window.innerWidth) * 2 - 1)
      rawY.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [fine, rawX, rawY])

  // Scroll: ao rolar para fora do herói, o conjunto inclina um pouco mais.
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] })
  const scroll = useTransform(scrollYProgress, (v) => (fine ? v : 0))
  const rotateX = useTransform([my, scroll], (v: number[]) => 13 - (v[0] ?? 0) * 2.5 + (v[1] ?? 0) * 9)
  const rotateY = useTransform(mx, (v) => -5 + v * 4)

  return (
    <LazyMotion features={loadFeatures}>
      <div ref={sectionRef}>
        <div ref={ref} className="lp-stage lp-stage-in relative mx-auto hidden min-[768px]:block" aria-hidden="true">
          <div className="lp-scale">
            <m.div className="lp-scene" style={{ rotateX, rotateY }}>
              <Layer box={{ left: -20, top: 10, width: 330, transform: 'translateZ(-260px) rotateY(-24deg)' }} depth={-1.4} mx={mx} my={my}>
                <HeroAgent />
              </Layer>
              <Layer box={{ left: 20, top: 352, width: 320, transform: 'translateZ(-140px) rotateY(-20deg)' }} depth={-0.8} mx={mx} my={my}>
                <HeroContacts />
              </Layer>
              <Layer box={{ left: 880, top: 30, width: 350, transform: 'translateZ(-200px) rotateY(22deg)' }} depth={-1.1} mx={mx} my={my}>
                <HeroAgenda created={created} />
              </Layer>
              <Layer box={{ left: 290, top: 60, width: 640, transform: 'translateZ(0)' }} depth={0} mx={mx} my={my}>
                <HeroChat step={step} fading={fading} />
              </Layer>
              <Layer box={{ left: 870, top: 470, width: 290, transform: 'translateZ(150px)' }} depth={0.9} mx={mx} my={my}>
                <NewBookingToast show={created && !fading} />
              </Layer>
              <Layer box={{ left: 1050, top: 196, width: 140, transform: 'translateZ(230px) rotate(9deg)' }} depth={1.6} mx={mx} my={my}>
                <div className="lp-float">
                  <PearGlass id="pg-hero" className="w-full" />
                </div>
              </Layer>
            </m.div>
          </div>
        </div>

        {/* Celular: uma janela só, com a história rodando */}
        <div className="lp-stage-in relative mx-auto mt-2 max-w-[520px] min-[768px]:hidden" aria-hidden="true">
          <MobileStory />
          <PearGlass id="pg-hero-m" className="lp-float absolute -right-1 -top-14 w-[66px]" />
        </div>
      </div>
    </LazyMotion>
  )
}

function MobileStory() {
  const { ref, step, fading } = useStepper<HTMLDivElement>({ durations: DURATIONS, final: HERO_FINAL, initial: 1 })
  return (
    <div ref={ref}>
      <HeroChat step={step} fading={fading} compact />
      <NewBookingToast show={step >= HERO_FINAL && !fading} className="relative -mt-7 ml-auto mr-3 w-[min(270px,85%)]" />
    </div>
  )
}
