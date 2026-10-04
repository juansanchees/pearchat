'use client'

import { useEffect } from 'react'

// Revelação ao rolar (fade + deslocamento curto, só opacity/transform: não muda o layout).
// Marca os blocos com .lp-reveal (e os títulos h2/h3 abaixo do herói). Não lê o layout na montagem: o próprio
// IntersectionObserver avisa o que já está na tela. O CSS só esconde com html.lp-js e com movimento permitido.
const AUTO = 'main > section:not(:first-child) h2, main > section:not(:first-child) h3'

/**
 * Âncoras da página (#funcionalidades, #planos…): rola até a seção e, quando o scroll termina, confere o pouso e
 * corrige. Necessário porque as seções com content-visibility usam altura estimada até serem renderizadas.
 * Também fecha o menu <details> do celular e vale para o carregamento com #hash na URL.
 */
function useAnchorFix() {
  useEffect(() => {
    const OFFSET = 84
    const go = (id: string, smooth: boolean) => {
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
      let tries = 0
      const check = () => {
        const top = el.getBoundingClientRect().top
        if (Math.abs(top - OFFSET) > 4 && tries++ < 4) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' })
          window.setTimeout(check, 120)
        }
      }
      if ('onscrollend' in window) window.addEventListener('scrollend', check, { once: true })
      window.setTimeout(check, smooth ? 1300 : 150)
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]')
      const id = a?.getAttribute('href')?.slice(1)
      if (!a || !id || !document.getElementById(id)) return
      e.preventDefault()
      a.closest('details')?.removeAttribute('open')
      window.history.pushState(null, '', `#${id}`)
      go(id, !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      // Leva o foco junto (teclado e leitores de tela continuam a partir da seção escolhida).
      const target = document.getElementById(id)!
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }
    document.addEventListener('click', onClick)
    const t = window.location.hash.length > 1 ? window.setTimeout(() => go(decodeURIComponent(window.location.hash.slice(1)), false), 60) : 0
    return () => {
      document.removeEventListener('click', onClick)
      window.clearTimeout(t)
    }
  }, [])
}

export function RevealObserver() {
  useAnchorFix()
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = Array.from(document.querySelectorAll<HTMLElement>(`.lp-reveal, ${AUTO}`)).filter(
      (el) => !el.closest('[aria-hidden="true"]') && !el.parentElement?.closest('.lp-reveal'),
    )
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
      io.observe(el)
    }
    document.documentElement.classList.add('lp-js')
    return () => {
      io.disconnect()
      document.documentElement.classList.remove('lp-js')
    }
  }, [])
  return null
}
