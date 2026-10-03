'use client'

import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'
import { emitContactsChanged } from '@/components/app/events'
import { api } from './api'
import { todayStamp } from './format'
import type { ImportResult } from './types'
import { useContactToasts } from './toasts'

const MAX_BYTES = 8 * 1024 * 1024

/** Importar (CSV -> API) e exportar (API -> download) contatos. */
export function useContactIo({ total, onImported }: { total: number; onImported: () => void }) {
  const toasts = useContactToasts()
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  const pickFile = useCallback(() => inputRef.current?.click(), [])

  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (file.size > MAX_BYTES) {
        toasts.error('Arquivo grande demais', 'O CSV pode ter até 8 MB e 20.000 linhas')
        return
      }
      setImporting(true)
      try {
        const form = new FormData()
        form.append('file', file)
        const result = await api<ImportResult>('/api/contacts/import', { method: 'POST', body: form })
        toasts.imported(result)
        emitContactsChanged()
        onImported()
      } catch (err) {
        toasts.error('Não foi possível importar', err instanceof Error ? err.message : 'Tente novamente')
      } finally {
        setImporting(false)
      }
    },
    [toasts, onImported],
  )

  const exportCsv = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch('/api/contacts/export', { cache: 'no-store' })
      redirectIfUnauthorized(res.status)
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contatos-${todayStamp()}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toasts.exported(total)
    } catch {
      toasts.error('Não foi possível exportar', 'Tente novamente em instantes')
    } finally {
      setExporting(false)
    }
  }, [exporting, total, toasts])

  return { inputRef, pickFile, onFile, importing, exporting, exportCsv }
}
