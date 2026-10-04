import { useEffect, type RefObject } from 'react'

/**
 * Progresso (0 a 1) de um elemento rolando pela tela, sem biblioteca: 0 quando o topo dele passa por `start`
 * (fração da altura da tela) e 1 quando a base passa por `end`. Só escuta o scroll enquanto o elemento está perto da
 * tela e lê o layout uma vez por quadro (requestAnimationFrame).
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, onProgress: (p: number) => void, start = 0.85, end = 0.5) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let raf = 0
    const read = () => {
      raf = 0
      if (!el.offsetParent) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const p = (vh * start - r.top) / (r.height + vh * (start - end))
      onProgress(Math.min(1, Math.max(0, p)))
    }
    const kick = () => {
      if (!raf) raf = window.requestAnimationFrame(read)
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          window.addEventListener('scroll', kick, { passive: true })
          window.addEventListener('resize', kick, { passive: true })
        } else {
          window.removeEventListener('scroll', kick)
          window.removeEventListener('resize', kick)
        }
        kick()
      },
      { rootMargin: '25% 0px 25% 0px' },
    )
    io.observe(el)
    kick()
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', kick)
      window.removeEventListener('resize', kick)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [ref, onProgress, start, end])
}
