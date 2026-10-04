'use client'

import { createElement, useCallback, useEffect, useState } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import type { ConversationItem } from './types'

type State = { pendente: boolean; respondendo: boolean }
const IDLE: State = { pendente: false, respondendo: false }
const RECHECK_MS = 5_000

// "Responder com a IA" da conversa aberta: pergunta ao servidor se ela está esperando resposta (a regra é uma só, no
// servidor: engine/pending.ts) e, ao clicar, pede a resposta. Enquanto o job roda o estado fica "respondendo" (o
// "digitando" da própria conversa vem do tempo real); a consulta se repete até a IA terminar ou desistir.
export function useAiReplyAction(conv: ConversationItem | null, iaOn: boolean) {
  const { toast } = useAppState()
  const [state, setState] = useState<State>(IDLE)
  const [nonce, setNonce] = useState(0) // sobe depois de um pedido: reinicia a consulta
  const id = conv?.id ?? null
  // Muda quando chega mensagem, a IA começa/termina de digitar ou o modo muda: reconsulta.
  const key = conv ? `${conv.lastMessageAt}|${conv.mode}|${conv.typing}|${conv.lastMessageAuthor ?? ''}` : ''

  useEffect(() => {
    if (!id || !iaOn) {
      setState(IDLE)
      return
    }
    let cancelled = false
    let timer: number | undefined
    const check = async () => {
      try {
        const res = await fetch(`/api/conversations/${id}/ai-reply`, { cache: 'no-store' })
        redirectIfUnauthorized(res.status)
        if (!res.ok || cancelled) return
        const s = (await res.json()) as State
        if (cancelled) return
        setState(s)
        if (s.respondendo) timer = window.setTimeout(() => void check(), RECHECK_MS)
      } catch {
        /* sem rede: a ação some até a próxima atualização */
      }
    }
    void check()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [id, iaOn, key, nonce])

  const request = useCallback(async () => {
    if (!id) return
    setState({ pendente: false, respondendo: true })
    try {
      const res = await fetch(`/api/conversations/${id}/ai-reply`, { method: 'POST', cache: 'no-store' })
      redirectIfUnauthorized(res.status)
      if (res.ok) {
        // O job já existe: o servidor passa a responder "respondendo" e a consulta se repete até a IA terminar.
        setNonce((n) => n + 1)
        return
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      setState(res.status === 409 ? IDLE : { pendente: true, respondendo: false })
      toast({ icon: createElement(WarningCircle, { size: 18, weight: 'fill' }), title: 'Não foi possível responder com a IA', text: data?.error ?? 'Tente novamente em instantes.' })
    } catch {
      setState({ pendente: true, respondendo: false })
      toast({ icon: createElement(WarningCircle, { size: 18, weight: 'fill' }), title: 'Não foi possível responder com a IA', text: 'Tente novamente em instantes.' })
    }
  }, [id, toast])

  return { ...state, request }
}
