'use client'

import { ArrowClockwise, DownloadSimple, FileText, ImageBroken, WarningCircle, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Spinner } from '@/components/pear'
import type { MessageDTO } from '@/lib/types'
import { MAX_INBOUND_BYTES, formatDuration } from '@/server/media/mime'
import { formatBytes } from './format'

// Conteúdo de mídia dentro da bolha (mesma bolha, tokens existentes). O arquivo vem de /api/media/<id>: com sessão,
// nunca por URL pública.

const url = (m: MessageDTO) => `/api/media/${m.id}`

function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portal no <body>: a bolha tem animação com transform, que faria o "fixed" ficar preso dentro dela.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagem em tamanho real"
      onClick={onClose}
      className="fixed inset-0 z-50 flex animate-zfIn items-center justify-center bg-black/60 p-4"
    >
      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a href={`${src}?download=1`} download={name} className="pc-btn pc-btn-secondary bg-light-surface text-[12px] no-underline">
          <DownloadSimple size={14} /> Baixar
        </a>
        <button type="button" onClick={onClose} aria-label="Fechar" className="pc-btn pc-btn-secondary pc-btn-icon bg-light-surface">
          <X size={16} />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} onClick={(e) => e.stopPropagation()} className="max-h-[86vh] max-w-[92vw] rounded-lg object-contain" />
    </div>,
    document.body,
  )
}

function Skeleton({ audio }: { audio?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-[10px] bg-light-neutral-900 text-[12px] text-light-neutral-500 ${audio ? 'h-9 w-[236px] max-w-full' : 'h-[140px] w-[220px] max-w-full'}`}
      role="status"
      aria-label="Carregando mídia"
    >
      <Spinner size={14} />
      {audio ? 'Carregando áudio…' : 'Carregando…'}
    </div>
  )
}

export function MediaContent({
  message,
  onRetry,
  onLoaded,
}: {
  message: MessageDTO
  onRetry: (messageId: string) => void
  onLoaded?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  const type = message.mediaType
  if (!type) return null
  const status = message.mediaStatus ?? 'pendente'
  const name = message.mediaName || 'arquivo'

  if (status === 'expirada') {
    return (
      <div className="flex items-center gap-1.5 rounded-[10px] bg-light-neutral-900 px-2.5 py-2 text-[12px] text-light-neutral-500">
        <ImageBroken size={14} />
        Mídia não disponível
      </div>
    )
  }
  if (status === 'pendente') return <Skeleton audio={type === 'audio'} />
  if (status === 'erro' || broken) {
    const tooBig = (message.mediaSize ?? 0) > MAX_INBOUND_BYTES
    return (
      <div className="flex flex-col items-start gap-1.5 rounded-[10px] bg-light-neutral-900 px-2.5 py-2 text-[12px] text-light-neutral-500">
        <span className="flex items-center gap-1.5">
          <WarningCircle size={14} />
          {tooBig ? 'Arquivo grande demais para carregar' : 'Não foi possível carregar a mídia'}
        </span>
        {!tooBig ? (
          <button type="button" onClick={() => onRetry(message.id)} className="pc-btn pc-btn-secondary px-2 py-[3px] text-[11.5px]">
            <ArrowClockwise size={12} /> Tentar de novo
          </button>
        ) : null}
      </div>
    )
  }

  const src = url(message)
  switch (type) {
    case 'image':
      return (
        <>
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir imagem em tamanho real" className="block max-w-[260px] cursor-zoom-in border-0 bg-transparent p-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={name}
              loading="lazy"
              onLoad={onLoaded}
              onError={() => setBroken(true)}
              className="block h-auto max-h-[320px] min-h-[60px] w-auto max-w-full rounded-[10px] bg-light-neutral-900 object-cover"
            />
          </button>
          {open ? <Lightbox src={src} name={name} onClose={() => setOpen(false)} /> : null}
        </>
      )
    case 'sticker':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Figurinha" loading="lazy" onLoad={onLoaded} onError={() => setBroken(true)} className="block h-[120px] w-[120px] object-contain" />
      )
    case 'video':
      return <video src={src} controls preload="metadata" onLoadedMetadata={onLoaded} onError={() => setBroken(true)} className="block max-h-[320px] w-[260px] max-w-full rounded-[10px] bg-black" />
    case 'audio':
      return (
        <div className="flex w-[236px] max-w-full flex-col gap-1.5">
          <audio src={src} controls preload="none" onError={() => setBroken(true)} className="h-9 w-full" />
          {message.mediaDurationSec ? <span className="text-[10.5px] text-light-neutral-500">{formatDuration(message.mediaDurationSec)}</span> : null}
          <Transcript message={message} />
        </div>
      )
    case 'document':
      return (
        <a
          href={`${src}?download=1`}
          download={name}
          className="flex w-[236px] max-w-full items-center gap-2.5 rounded-[10px] bg-light-neutral-900 px-2.5 py-2 text-light-text no-underline hover:bg-light-neutral-800"
        >
          <FileText size={26} className="shrink-0 text-light-accent-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">{name}</span>
            <span className="block text-[10.5px] text-light-neutral-500">{message.mediaSize ? formatBytes(message.mediaSize) : 'Documento'}</span>
          </span>
          <DownloadSimple size={16} className="shrink-0 text-light-accent-400" aria-label="Baixar" />
        </a>
      )
    default:
      return null
  }
}

function Transcript({ message }: { message: MessageDTO }) {
  const st = message.transcriptStatus
  if (!st || st === 'indisponivel') return null
  return (
    <div className="border-0 border-t border-solid border-light-divider pt-1.5">
      <div className="text-[10.5px] font-medium text-light-neutral-500">Transcrição</div>
      {st === 'pendente' ? (
        <div className="flex items-center gap-1.5 text-[11.5px] text-light-neutral-500">
          <Spinner size={11} /> Transcrevendo…
        </div>
      ) : st === 'erro' ? (
        <div className="text-[11.5px] text-light-neutral-500">Não foi possível transcrever</div>
      ) : message.transcript ? (
        <div className="whitespace-pre-wrap break-words text-[11.5px] leading-[1.4] text-light-neutral-300">{message.transcript}</div>
      ) : (
        <div className="text-[11.5px] text-light-neutral-500">Sem fala detectada</div>
      )}
    </div>
  )
}
