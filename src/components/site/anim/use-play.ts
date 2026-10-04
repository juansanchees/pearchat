import { useEffect, useRef, useState, type RefObject } from 'react'

// Ganchos das animações da página inicial (sem biblioteca): visibilidade na tela, aba oculta,
// prefers-reduced-motion e um "tocador de passos" por temporizador. Só usados em ilhas cliente.

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function usePageVisible() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    on()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/** `true` enquanto o elemento está (ao menos em parte) na tela. `seen` fica `true` depois da primeira vez. */
export function useInView(ref: RefObject<Element | null>, rootMargin = '0px') {
  const [state, setState] = useState({ inView: false, seen: false })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setState((s) => ({ inView: !!e?.isIntersecting, seen: s.seen || !!e?.isIntersecting })), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return state
}

/** Pode animar agora: na tela, aba visível e sem preferência por menos movimento. */
export function usePlay(ref: RefObject<Element | null>, rootMargin?: string) {
  const { inView, seen } = useInView(ref, rootMargin)
  const page = usePageVisible()
  const reduced = useReducedMotion()
  return { play: inView && page && !reduced, seen, reduced }
}

type StepperOpts = {
  /** Quanto tempo (ms) cada passo fica na tela antes de avançar; o tamanho define o número de passos. */
  durations: number[]
  /** Passo mostrado sem JavaScript, antes de entrar na tela e com movimento reduzido. */
  final?: number
  /** Passo usado antes de a seção ser vista (padrão: `final`). No herói é o primeiro passo da história. */
  initial?: number
  loop?: boolean
  /** Controle externo (ex.: painel ativo no "Como funciona"). */
  enabled?: boolean
  rootMargin?: string
}

/**
 * Avança `step` por temporizador enquanto o elemento está na tela. Ao ser visto pela primeira vez, recomeça do 0.
 * Fora da tela ou com a aba oculta, pausa (sem perder o passo). Com movimento reduzido, fica no passo final.
 * `fading` fica `true` por um instante antes de recomeçar o laço (para um esmaecer suave).
 */
export function useStepper<T extends Element>({ durations, final = durations.length - 1, initial, loop = true, enabled = true, rootMargin }: StepperOpts) {
  const ref = useRef<T>(null)
  const { play, seen, reduced } = usePlay(ref, rootMargin)
  const [step, setStep] = useState(initial ?? final)
  const [fading, setFading] = useState(false)
  const started = useRef(false)
  const last = durations.length - 1

  useEffect(() => {
    if (reduced) {
      setStep(final)
      setFading(false)
      return
    }
    if (!enabled) {
      started.current = false
      setStep(0)
      setFading(false)
      return
    }
    if (seen && !started.current) {
      started.current = true
      setStep(0)
    }
  }, [seen, reduced, enabled, final])

  useEffect(() => {
    if (!play || !enabled || !started.current) return
    const wait = durations[step] ?? 1000
    if (step >= last) {
      if (!loop) return
      const t1 = window.setTimeout(() => setFading(true), Math.max(0, wait - 450))
      const t2 = window.setTimeout(() => {
        setFading(false)
        setStep(0)
      }, wait)
      return () => {
        window.clearTimeout(t1)
        window.clearTimeout(t2)
      }
    }
    const t = window.setTimeout(() => setStep((s) => Math.min(s + 1, last)), wait)
    return () => window.clearTimeout(t)
  }, [play, enabled, step, last, loop, durations])

  return { ref, step, fading, play, reduced }
}
