'use client'

import { FileText, MusicNote, PaperPlaneRight, Paperclip, VideoCamera, WarningCircle, X } from '@phosphor-icons/react'
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { useAppState } from '@/components/app/app-state'
import { Spinner } from '@/components/pear'
import { MAX_OUTBOUND_BYTES } from '@/server/media/mime'
import { formatBytes } from './format'

// O que o seletor de arquivos oferece (o servidor confere de novo pelo conteúdo do arquivo).
const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,audio/*,video/mp4,video/quicktime,video/webm,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv'
const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|mp3|ogg|oga|opus|m4a|aac|wav|mp4|mov|webm|3gp|pdf|docx?|xlsx?|pptx?|odt|ods|txt|csv)$/i
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/(mp4|quicktime|webm|3gpp)|application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.)|text\/(plain|csv))/i

/** Mensagem clara antes de enviar, ou null se o arquivo pode seguir. */
function fileProblem(f: File): string | null {
  if (f.size === 0) return 'O arquivo está vazio.'
  if (f.size > MAX_OUTBOUND_BYTES) return `O arquivo tem ${formatBytes(f.size)} e o limite é 16 MB.`
  const okType = f.type ? ALLOWED_MIME.test(f.type) : ALLOWED_EXT.test(f.name)
  if (!okType || (f.type === 'image/svg+xml')) return 'Esse tipo de arquivo não pode ser enviado. Use imagem, áudio, vídeo, PDF ou documento do Office.'
  return null
}

export function Composer({
  iaAnswering,
  onSend,
  onSendMedia,
  incomingFile,
  onIncomingConsumed,
}: {
  iaAnswering: boolean
  onSend: (text: string) => Promise<boolean>
  onSendMedia: (file: File, caption: string, onProgress: (pct: number) => void) => Promise<boolean>
  /** Arquivo arrastado para a área da conversa. */
  incomingFile?: File | null
  onIncomingConsumed?: () => void
}) {
  const { toast } = useAppState()
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Texto em envio: Enter repetido/duplo clique com o mesmo texto não dispara outro envio antes de o primeiro terminar.
  const inFlight = useRef<string | null>(null)
  const sendingMedia = useRef(false)

  const isImage = !!file && file.type.startsWith('image/') && file.type !== 'image/svg+xml'
  const previewUrl = useMemo(() => (file && isImage ? URL.createObjectURL(file) : null), [file, isImage])
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function pick(f: File | null | undefined) {
    if (!f) return
    const problem = fileProblem(f)
    if (problem) {
      toast({ icon: createElement(WarningCircle, { size: 18, weight: 'fill' }), title: 'Arquivo não permitido', text: problem })
      return
    }
    setFile(f)
  }

  useEffect(() => {
    if (!incomingFile) return
    pick(incomingFile)
    onIncomingConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFile])

  async function submit() {
    if (file) {
      if (sendingMedia.current) return
      sendingMedia.current = true
      setProgress(0)
      const caption = draft
      let ok = false
      try {
        ok = await onSendMedia(file, caption, setProgress)
      } finally {
        sendingMedia.current = false
        setProgress(null)
      }
      if (ok) {
        setFile(null)
        setDraft('')
      }
      return
    }
    const text = draft.trim()
    if (!text || inFlight.current === text) return
    inFlight.current = text
    setDraft('')
    let ok = false
    try {
      ok = await onSend(text)
    } finally {
      inFlight.current = null
    }
    // Rollback: devolve o texto ao campo se nada novo foi digitado.
    if (!ok) setDraft((cur) => (cur === '' ? text : cur))
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  // Ctrl+V com imagem na área de transferência (print, foto copiada).
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'))
    if (!f) return
    e.preventDefault()
    // Prints colados chegam como "image.png": nome mais útil na conversa.
    pick(f.name && f.name !== 'image.png' ? f : new File([f], `imagem-${Date.now().toString(36)}.${f.type.split('/')[1] ?? 'png'}`, { type: f.type }))
  }

  const sending = progress !== null
  const isAudio = !!file && file.type.startsWith('audio/')

  return (
    <div className="border-0 border-t border-solid border-light-divider bg-light-surface" onPaste={onPaste}>
      {file ? (
        <div className="flex items-center gap-3 border-0 border-b border-solid border-light-divider px-4 py-2.5">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Prévia do arquivo" className="h-[52px] w-[52px] rounded-md object-cover" />
          ) : (
            <span className="grid h-[52px] w-[52px] place-items-center rounded-md bg-light-neutral-900 text-light-accent-400">
              {isAudio ? <MusicNote size={24} /> : file.type.startsWith('video/') ? <VideoCamera size={24} /> : <FileText size={24} />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium">{file.name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-light-neutral-500">
              {sending ? (
                <>
                  <Spinner size={11} /> Enviando… {progress}%
                </>
              ) : (
                formatBytes(file.size)
              )}
            </div>
            {sending ? (
              <div className="mt-1 h-[4px] rounded-pill bg-light-neutral-900">
                <div className="h-full rounded-pill bg-[linear-gradient(90deg,#7acc4a,#2e9a48)] transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            title="Remover arquivo"
            aria-label="Remover arquivo"
            disabled={sending}
            onClick={() => setFile(null)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md p-0 text-light-neutral-500 hover:bg-light-neutral-900 disabled:opacity-50"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          hidden
          aria-label="Escolher arquivo"
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          title="Anexar"
          aria-label="Anexar"
          disabled={sending}
          onClick={() => fileInput.current?.click()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-light-accent-500 hover:bg-[rgba(46,154,72,.10)] disabled:opacity-50"
        >
          <Paperclip size={17} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={file ? 1024 : 4096}
          disabled={sending || isAudio}
          placeholder={isAudio ? 'Áudio não leva legenda' : file ? 'Adicionar legenda (opcional)' : iaAnswering ? 'Escreva para assumir a conversa' : 'Digite uma mensagem'}
          aria-label={file ? 'Legenda' : 'Mensagem'}
          className="min-h-9 min-w-0 flex-1 rounded-md border border-solid border-light-divider bg-light-surface px-2.5 py-1.5 text-sm text-light-text caret-light-accent-500 hover:border-light-neutral-500 focus-visible:border-light-accent-500 focus-visible:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-solid border-light-accent-500 px-3.5 py-2 text-sm font-medium leading-tight text-light-accent-300 hover:bg-[rgba(46,154,72,.12)] active:bg-[rgba(46,154,72,.22)] disabled:opacity-60"
        >
          <PaperPlaneRight size={16} />
          Enviar
        </button>
      </div>
    </div>
  )
}
