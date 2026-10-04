'use client'

import { FileText, GearSix, Lightning, MusicNote, PaperPlaneRight, Paperclip, VideoCamera, WarningCircle, X } from '@phosphor-icons/react'
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react'
import { useAppState } from '@/components/app/app-state'
import { Spinner } from '@/components/pear'
import { expandQuickReply, filterQuickReplies } from '@/lib/quick-replies'
import type { QuickReplyDTO, QuickReplyList } from '@/lib/quick-replies'
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

const qrItemClass =
  'flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-[10px] py-[8px] text-left text-[12.5px] text-light-text'

export function Composer({
  iaAnswering,
  contact,
  onSend,
  onSendMedia,
  incomingFile,
  onIncomingConsumed,
}: {
  iaAnswering: boolean
  /** Dados do contato da conversa aberta, para as variáveis das respostas rápidas. */
  contact?: { nome: string; telefone: string | null }
  onSend: (text: string) => Promise<boolean>
  onSendMedia: (file: File, caption: string, onProgress: (pct: number) => void) => Promise<boolean>
  /** Arquivo arrastado para a área da conversa. */
  incomingFile?: File | null
  onIncomingConsumed?: () => void
}) {
  const { toast, openDrawer } = useAppState()
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // ---- Respostas rápidas ("/" no campo ou botão do raio) ----
  const [qrList, setQrList] = useState<QuickReplyList | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrQuery, setQrQuery] = useState('')
  // Início da "/consulta" no texto (-1 = aberta pelo botão, sem barra).
  const [qrFrom, setQrFrom] = useState(-1)
  const [qrActive, setQrActive] = useState(0)
  const qrItems = useMemo(() => filterQuickReplies(qrList?.items ?? [], qrQuery), [qrList, qrQuery])
  // Último índice = "Gerenciar respostas rápidas".
  const manageIdx = qrItems.length
  const listId = 'qr-listbox'

  const loadQr = useCallback(() => {
    fetch('/api/quick-replies', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<QuickReplyList>) : null))
      .then((d) => {
        if (d) setQrList(d)
      })
      .catch(() => {})
  }, [])

  function closeQr() {
    setQrOpen(false)
    setQrFrom(-1)
    setQrQuery('')
  }

  function openQr(from: number, query: string) {
    if (!qrOpen) loadQr()
    setQrOpen(true)
    setQrFrom(from)
    setQrQuery(query)
    setQrActive(0)
  }

  function insertQr(it: QuickReplyDTO) {
    if (!qrList) return
    const { text, select } = expandQuickReply(it.texto, { nome: contact?.nome, telefone: contact?.telefone, empresa: qrList.vars.empresa, horario: qrList.vars.horario })
    const el = inputRef.current
    const caret = el?.selectionStart ?? draft.length
    // Troca a "/consulta" pelo texto; aberta pelo botão, insere no cursor.
    const start = qrFrom >= 0 ? qrFrom : caret
    const end = caret
    const limit = file ? 1024 : 4096
    const next = (draft.slice(0, start) + text + draft.slice(end)).slice(0, limit)
    setDraft(next)
    closeQr()
    const sel: [number, number] = select ? [start + select[0], start + select[1]] : [start + text.length, start + text.length]
    requestAnimationFrame(() => {
      const i = inputRef.current
      if (!i) return
      i.focus()
      const a = Math.min(sel[0], next.length)
      const b = Math.min(sel[1], next.length)
      i.setSelectionRange(a, b)
      // Para o cursor/seleção ficar visível quando o texto é maior que o campo.
      if (a === b) i.scrollLeft = i.scrollWidth
    })
    void fetch(`/api/quick-replies/${it.id}/used`, { method: 'POST' }).catch(() => {})
  }

  function manageQr() {
    closeQr()
    // A seção "Respostas rápidas" do drawer lê esta marca ao carregar e rola até ela (ver quick-replies-section.tsx).
    ;(window as unknown as { __pcScrollQr?: number }).__pcScrollQr = Date.now()
    openDrawer('config')
  }

  function onDraftChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setDraft(value)
    // "/" no início ou depois de espaço, até o cursor, sem espaço no meio.
    const caret = e.target.selectionStart ?? value.length
    const m = /(^|\s)\/([a-zA-Z0-9-]*)$/.exec(value.slice(0, caret))
    if (m) openQr(caret - m[2]!.length - 1, m[2]!)
    else if (qrOpen && qrFrom >= 0) closeQr()
  }
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
    if (qrOpen) {
      const total = qrItems.length + 1
      if (e.key === 'Escape') {
        e.preventDefault()
        closeQr()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setQrActive((i) => (e.key === 'ArrowDown' ? (i + 1) % total : (i - 1 + total) % total))
        return
      }
      // Sem nenhuma resposta casando, Enter segue o caminho normal (enviar o que foi digitado).
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && (qrItems.length > 0 || qrFrom < 0)) {
        e.preventDefault()
        if (qrActive === manageIdx) manageQr()
        else if (qrItems[qrActive]) insertQr(qrItems[qrActive]!)
        return
      }
    }
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
      <div className="relative flex items-center gap-2.5 px-4 py-3">
        {qrOpen ? (
          <div
            id={listId}
            role="listbox"
            aria-label="Respostas rápidas"
            onMouseDown={(e) => e.preventDefault()}
            className="absolute bottom-full left-4 right-4 z-30 mb-1 max-h-[280px] overflow-y-auto rounded-lg border border-solid border-light-divider bg-light-surface p-[6px] shadow-[0_12px_32px_rgba(0,0,0,.28)] sm:right-auto sm:w-[420px]"
          >
            {!qrList ? (
              <div className="flex items-center gap-2 px-[10px] py-[8px] text-[12px] text-light-neutral-500">
                <Spinner size={12} /> Carregando…
              </div>
            ) : (
              <>
                {qrItems.length === 0 ? <div className="px-[10px] py-[8px] text-[12px] text-light-neutral-500">Nenhuma resposta com esse atalho.</div> : null}
                {qrItems.map((it, i) => (
                  <div
                    key={it.id}
                    id={`qr-opt-${it.id}`}
                    role="option"
                    aria-selected={i === qrActive}
                    onMouseEnter={() => setQrActive(i)}
                    onClick={() => insertQr(it)}
                    className={`${qrItemClass} cursor-pointer ${i === qrActive ? 'bg-[rgba(29,33,23,.07)]' : ''}`}
                  >
                    <span className="flex-none font-mono text-[12px] text-light-accent-300">/{it.atalho}</span>
                    <span className="min-w-0 flex-1 truncate text-light-neutral-500">
                      {expandQuickReply(it.texto, { nome: contact?.nome, telefone: contact?.telefone, empresa: qrList.vars.empresa, horario: qrList.vars.horario }).text.replace(/\s+/g, ' ')}
                    </span>
                  </div>
                ))}
                <div
                  id="qr-opt-manage"
                  role="option"
                  aria-selected={qrActive === manageIdx}
                  onMouseEnter={() => setQrActive(manageIdx)}
                  onClick={manageQr}
                  className={`${qrItemClass} cursor-pointer border-0 ${qrItems.length > 0 ? 'mt-1 border-t border-solid border-light-divider pt-[10px]' : ''} ${qrActive === manageIdx ? 'bg-[rgba(29,33,23,.07)]' : ''}`}
                >
                  <GearSix size={14} className="flex-none text-light-neutral-500" />
                  <span className="flex-1">Gerenciar respostas rápidas</span>
                </div>
              </>
            )}
          </div>
        ) : null}
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
        <button
          type="button"
          title="Respostas rápidas"
          aria-label="Respostas rápidas"
          aria-haspopup="listbox"
          aria-expanded={qrOpen}
          aria-controls={qrOpen ? listId : undefined}
          disabled={sending || isAudio}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (qrOpen) closeQr()
            else {
              inputRef.current?.focus()
              openQr(-1, '')
            }
          }}
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md p-0 text-light-accent-500 hover:bg-[rgba(46,154,72,.10)] disabled:opacity-50"
        >
          <Lightning size={17} />
        </button>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={qrOpen}
          aria-controls={qrOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={qrOpen ? (qrActive === manageIdx ? 'qr-opt-manage' : qrItems[qrActive] ? `qr-opt-${qrItems[qrActive]!.id}` : undefined) : undefined}
          value={draft}
          onChange={onDraftChange}
          onBlur={() => qrOpen && closeQr()}
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
