'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { CalendarCheck } from '@/components/site/ui/icons'
import { PearGlass } from '@/components/brand/pear-glass'
import { cn } from '@/lib/utils'
import { useStepper } from '../anim/use-play'
import { HERO_FINAL, HeroAgenda, HeroAgent, HeroChat, HeroContacts } from '../mini/hero-windows'

// Palco do herói (ilha cliente). A mini-história roda em laço (useStepper). As camadas respondem ao mouse (parallax por
// profundidade, amortecido) e ao scroll (o conjunto inclina): um laço requestAnimationFrame só enquanto há movimento
// escreve três variáveis CSS na cena (--mx, --my, --sp); a inclinação e os deslocamentos são calculados no CSS
// (globals.css, .lp-scene e .lp-par), só com transform. Parallax do mouse desligado em toque e com movimento reduzido.

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
        <span className="mt-0.5 block truncate text-[11.5px] text-light-neutral-400">Rafael Costa · amanhã, 16:00</span>
      </span>
    </div>
  )
}

/** Camada: posição/profundidade fixas em 3D e um deslocamento de parallax proporcional a `depth` (via CSS). */
function Layer({ box, depth, children }: { box: { left: number; top: number; width: number; transform: string }; depth: number; children: ReactNode }) {
  return (
    <div className="lp-layer" style={{ left: box.left, top: box.top, width: box.width, transform: box.transform }}>
      <div className="lp-par" style={{ '--d': depth } as CSSProperties}>
        {children}
      </div>
    </div>
  )
}

function useStageMotion(stage: RefObject<HTMLDivElement | null>, scene: RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    const st = stage.current
    const sc = scene.current
    if (!st || !sc || typeof IntersectionObserver === 'undefined') return
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    let raf = 0
    let visible = false
    const frame = () => {
      raf = 0
      cx += (tx - cx) * 0.07
      cy += (ty - cy) * 0.07
      const r = st.getBoundingClientRect()
      const sp = reduced.matches ? 0 : Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)))
      sc.style.setProperty('--mx', cx.toFixed(4))
      sc.style.setProperty('--my', cy.toFixed(4))
      sc.style.setProperty('--sp', sp.toFixed(4))
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) kick()
    }
    const kick = () => {
      if (!raf && visible) raf = window.requestAnimationFrame(frame)
    }
    const move = (e: PointerEvent) => {
      if (!fine.matches || reduced.matches || e.pointerType !== 'mouse') return
      tx = (e.clientX / window.innerWidth) * 2 - 1
      ty = (e.clientY / window.innerHeight) * 2 - 1
      kick()
    }
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting
      kick()
    })
    io.observe(st)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('scroll', kick, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('scroll', kick)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [stage, scene, ready])
}

export function HeroStage() {
  const { ref, step, fading } = useStepper<HTMLDivElement>({ durations: DURATIONS, final: HERO_FINAL, initial: 1 })
  const created = step >= HERO_FINAL
  const sceneRef = useRef<HTMLDivElement>(null)
  // A cena 3D (só existe a partir de 768 px) é montada depois de hidratar: o contêiner já tem a altura certa e a
  // cena entra com o mesmo fade do palco. Assim o HTML inicial (e o celular) não carregam as quatro janelas.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useStageMotion(ref, sceneRef, mounted)

  return (
    <div>
      <div ref={ref} className="lp-stage lp-stage-in relative mx-auto hidden min-[768px]:block" aria-hidden="true">
        <div className="lp-scale">
          {mounted && (
          <div ref={sceneRef} className="lp-scene lp-fade-in">
            <Layer box={{ left: -20, top: 10, width: 330, transform: 'translateZ(-260px) rotateY(-24deg)' }} depth={-1.4}>
              <HeroAgent />
            </Layer>
            <Layer box={{ left: 20, top: 352, width: 320, transform: 'translateZ(-140px) rotateY(-20deg)' }} depth={-0.8}>
              <HeroContacts />
            </Layer>
            <Layer box={{ left: 880, top: 30, width: 350, transform: 'translateZ(-200px) rotateY(22deg)' }} depth={-1.1}>
              <HeroAgenda created={created} />
            </Layer>
            <Layer box={{ left: 290, top: 60, width: 640, transform: 'translateZ(0)' }} depth={0}>
              <HeroChat step={step} fading={fading} />
            </Layer>
            <Layer box={{ left: 870, top: 470, width: 290, transform: 'translateZ(150px)' }} depth={0.9}>
              <NewBookingToast show={created && !fading} />
            </Layer>
            <Layer box={{ left: 236, top: 462, width: 132, transform: 'translateZ(230px) rotate(-8deg)' }} depth={1.6}>
              <div className="lp-float">
                <PearGlass id="pg-hero" className="w-full" />
              </div>
            </Layer>
          </div>
          )}
        </div>
      </div>

      {/* Celular: uma janela só, com a história rodando */}
      <div className="lp-stage-in relative mx-auto mt-2 max-w-[520px] min-[768px]:hidden" aria-hidden="true">
        <MobileStory />
        <PearGlass id="pg-hero-m" className="lp-float absolute -right-1 -top-14 w-[66px]" />
      </div>
    </div>
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
