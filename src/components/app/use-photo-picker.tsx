'use client'

import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Camera, WarningCircle } from '@phosphor-icons/react'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { useAppState } from './app-state'

const SIZE = 256
const MAX_INPUT_BYTES = 25 * 1024 * 1024

async function decode(file: File): Promise<{ source: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bmp = await createImageBitmap(file)
    }
    return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
  }
  // Fallback: <img> (os navegadores atuais já aplicam a orientação EXIF ao desenhar).
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Recorte central quadrado, 256×256, JPEG: o upload fica pequeno e a foto sempre quadrada. */
async function cropToSquare(file: File): Promise<Blob> {
  const img = await decode(file)
  try {
    const side = Math.min(img.w, img.h)
    if (!side) throw new Error('Imagem vazia')
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas indisponível')
    ctx.fillStyle = '#ffffff' // PNG com transparência não vira preto no JPEG
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, (img.w - side) / 2, (img.h - side) / 2, side, side, 0, 0, SIZE, SIZE)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Não foi possível preparar a imagem')
    return blob
  } finally {
    img.close()
  }
}

// Seletor de foto: recorta no navegador e envia. `user` (padrão) = foto de perfil, /api/me/avatar (fica salva na conta);
// `logo` = logo do negócio do WhatsApp (espaço) ativo, /api/spaces/<id>/logo (só dono/administrador).
export function usePhotoPicker(target: 'user' | 'logo' = 'user') {
  const { setUser, toast, user, spaces, workspaceId, refreshSpaces } = useAppState()
  const isLogo = target === 'logo'
  const noun = isLogo ? 'logo' : 'foto'
  const url = isLogo ? `/api/spaces/${workspaceId}/logo` : '/api/me/avatar'
  const ref = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const busy = useRef(false)

  const open = useCallback(() => {
    if (!busy.current) ref.current?.click()
  }, [])

  const problem = useCallback(
    (text: string) => toast({ icon: <WarningCircle size={18} weight="fill" />, title: `Não foi possível trocar a ${noun}`, text }),
    [toast, noun],
  )

  const onChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || busy.current) return
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return problem('Use uma imagem JPEG, PNG ou WebP.')
      if (file.size > MAX_INPUT_BYTES) return problem('A imagem é grande demais. Escolha uma de até 25 MB.')
      busy.current = true
      setUploading(true)
      try {
        const blob = await cropToSquare(file)
        const form = new FormData()
        form.append('file', blob, 'avatar.jpg')
        const res = await fetch(url, { method: isLogo ? 'PUT' : 'POST', body: form })
        const data: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          redirectIfUnauthorized(res.status)
          const msg = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Tente novamente em instantes.'
          return problem(msg)
        }
        if (isLogo) {
          await refreshSpaces()
          toast({ icon: <Camera size={18} weight="fill" />, title: 'Logo atualizada', text: 'Ela aparece no menu e na página de agendamento' })
        } else {
          const fotoUrl = data && typeof data === 'object' && 'fotoUrl' in data && typeof data.fotoUrl === 'string' ? data.fotoUrl : null
          if (fotoUrl) setUser({ fotoUrl })
          toast({ icon: <Camera size={18} weight="fill" />, title: 'Foto atualizada', text: 'Ela fica salva na sua conta' })
        }
      } catch {
        problem('Não consegui ler essa imagem. Tente outra.')
      } finally {
        busy.current = false
        setUploading(false)
      }
    },
    [problem, setUser, toast, url, isLogo, refreshSpaces],
  )

  const remove = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setUploading(true)
    try {
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) {
        redirectIfUnauthorized(res.status)
        return problem('Tente novamente em instantes.')
      }
      if (isLogo) {
        await refreshSpaces()
        toast({ icon: <Camera size={18} weight="fill" />, title: 'Logo removida' })
      } else {
        const data = (await res.json().catch(() => null)) as { fotoUrl?: string | null } | null
        setUser({ fotoUrl: data?.fotoUrl ?? null })
        toast({ icon: <Camera size={18} weight="fill" />, title: 'Foto removida' })
      }
    } catch {
      problem('Verifique sua conexão e tente novamente.')
    } finally {
      busy.current = false
      setUploading(false)
    }
  }, [problem, setUser, toast, url, isLogo, refreshSpaces])

  const input = <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onChange(e)} aria-hidden tabIndex={-1} />
  // Só a foto enviada ao PearChat pode ser removida; a do Google continua como padrão.
  const logo = spaces.espacos.find((e) => e.id === workspaceId)?.logoUrl ?? null
  const fotoUrl = isLogo ? logo : user.fotoUrl
  const hasOwn = isLogo ? !!logo : !!user.fotoUrl && user.fotoUrl.startsWith('/api/avatar/')
  return { open, input, fotoUrl, uploading, hasOwn, remove }
}
