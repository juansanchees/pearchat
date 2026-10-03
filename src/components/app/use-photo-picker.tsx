'use client'

import { useCallback, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Camera } from '@phosphor-icons/react'
import { useAppState } from './app-state'

// Seletor de foto de perfil: mostra na hora via object URL (sem upload por enquanto).
export function usePhotoPicker() {
  const { setUser, toast, user } = useAppState()
  const ref = useRef<HTMLInputElement>(null)
  const prevUrl = useRef<string | null>(null)

  const open = useCallback(() => ref.current?.click(), [])

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current)
      const url = URL.createObjectURL(file)
      prevUrl.current = url
      setUser({ fotoUrl: url })
      toast({ icon: <Camera size={18} weight="fill" />, title: 'Foto atualizada', text: 'Seu perfil já mostra a nova foto' })
      e.target.value = ''
    },
    [setUser, toast],
  )

  const input = <input ref={ref} type="file" accept="image/*" className="hidden" onChange={onChange} aria-hidden tabIndex={-1} />
  return { open, input, fotoUrl: user.fotoUrl }
}
