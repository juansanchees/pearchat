'use client'

import { useEffect } from 'react'

// Revelação ao rolar (fade + deslocamento curto, só opacity/transform: não muda o layout).
// Marca os blocos com .lp-reveal (e os títulos h2/h3 abaixo do herói); o que já está na tela ao carregar
// aparece direto, sem piscar. O CSS só esconde com html.lp-js e com movimento permitido (globals.css).
const AUTO = 'main > section:not(:first-child) h2, main > section:not(:first-child) h3'

export function RevealObserver() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = Array.from(document.querySelectorAll<HTMLElement>(`.lp-reveal, ${AUTO}`)).filter((el) => !el.closest('[aria-hidden="true"]') && !el.parentElement?.closest('.lp-reveal'))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('lp-in')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    for (const el of els) {
      el.classList.add('lp-reveal')
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('lp-in')
      else io.observe(el)
    }
    document.documentElement.classList.add('lp-js')
    return () => {
      io.disconnect()
      document.documentElement.classList.remove('lp-js')
    }
  }, [])
  return null
}
