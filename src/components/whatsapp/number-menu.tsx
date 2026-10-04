'use client'

import { useEffect, useRef, useState } from 'react'
import { Archive, ArrowsLeftRight, ClockClockwise, DotsThree, PencilSimple, Plugs } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { useDisconnect } from '@/components/app/use-disconnect'
import { Tag } from '@/components/pear'
import { redirectIfUnauthorized } from '@/lib/auth-redirect'

type Mode = 'menu' | 'rename' | 'disconnect' | 'switch' | 'archive'

const item =
  'flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-[10px] py-[8px] text-left text-[12.5px] text-light-text hover:bg-[rgba(29,33,23,.07)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'

/**
 * Menu do número (botão de três pontos ao lado do título): renomear, importar conversas anteriores, desconectar,
 * trocar para a API oficial (em breve) e arquivar. Confirmações são inline (sem diálogo).
 */
export function NumberMenu({ onImport, importing = false }: { onImport?: () => void; importing?: boolean }) {
  const { user, setUser, connected, wa, spaces, workspaceId, refreshSpaces, toast, connectCfg } = useAppState()
  const disconnect = useDisconnect()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('menu')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setMode('menu')
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false)
        setMode('menu')
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setMode('menu')
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const canArchive = !connected && wa.status !== 'conectando' && spaces.espacos.length > 1
  // Trocar de tipo de conexão: oficial só quando a Meta está configurada (ou no demo). Habilita sozinho com as variáveis.
  const oficialOk = connectCfg.demo || connectCfg.metaConfigured
  const toOficial = wa.provider !== 'oficial'
  const switchEnabled = toOficial ? oficialOk : true
  const canImport = !!onImport && wa.provider === 'rapida' && connected

  async function rename() {
    const nome = name.trim()
    if (!nome || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/spaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      })
      redirectIfUnauthorized(res.status)
      if (!res.ok) throw new Error(String(res.status))
      setUser({ empresa: nome })
      void refreshSpaces()
      toast({ icon: <PencilSimple size={18} weight="fill" />, title: 'WhatsApp renomeado', text: nome })
      close()
    } catch {
      toast({ title: 'Não foi possível renomear', text: 'Tente novamente em instantes.' })
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/spaces/${workspaceId}/archive`, { method: 'POST' })
      redirectIfUnauthorized(res.status)
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null)
        const msg = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Tente novamente em instantes.'
        toast({ title: 'Não foi possível arquivar', text: msg })
        setBusy(false)
        return
      }
      // O servidor já passou a conta para outro WhatsApp: recarrega no espaço novo.
      window.location.assign('/whatsapp')
    } catch {
      toast({ title: 'Não foi possível arquivar', text: 'Verifique sua conexão e tente novamente.' })
      setBusy(false)
    }
  }

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-label="Menu do número"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Menu do número"
        onClick={() => (open ? close() : setOpen(true))}
        className="grid h-8 w-8 place-items-center rounded-md border border-solid border-light-divider bg-light-surface p-0 text-light-text hover:bg-[rgba(29,33,23,.07)]"
      >
        <DotsThree size={18} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[38px] z-50 w-[270px] rounded-lg border border-solid border-light-divider bg-light-surface p-[6px] shadow-[0_12px_32px_rgba(0,0,0,.28)]"
        >
          {mode === 'menu' && (
            <>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setName(user.empresa)
                  setMode('rename')
                }}
              >
                <PencilSimple size={15} aria-hidden="true" />
                Renomear
              </button>
              {canImport && (
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  disabled={importing}
                  onClick={() => {
                    onImport?.()
                    close()
                  }}
                >
                  <ClockClockwise size={15} aria-hidden="true" />
                  {importing ? 'Importando conversas…' : 'Importar conversas anteriores'}
                </button>
              )}
              {connected && (
                <button type="button" role="menuitem" className={item} onClick={() => setMode('disconnect')}>
                  <Plugs size={15} aria-hidden="true" />
                  Desconectar WhatsApp
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={!switchEnabled}
                aria-disabled={!switchEnabled}
                title={switchEnabled ? undefined : 'A API oficial será configurada depois'}
                onClick={() => setMode('switch')}
              >
                <ArrowsLeftRight size={15} aria-hidden="true" />
                <span className="flex-1">{toOficial ? 'Trocar para API oficial' : 'Trocar para conexão rápida'}</span>
                {!switchEnabled && <Tag tone="outline" className="flex-none !px-[6px] !py-px !text-[9.5px]">Em breve</Tag>}
              </button>
              {canArchive && (
                <button type="button" role="menuitem" className={item} onClick={() => setMode('archive')}>
                  <Archive size={15} aria-hidden="true" />
                  Arquivar este WhatsApp
                </button>
              )}
            </>
          )}

          {mode === 'rename' && (
            <form
              className="flex flex-col gap-2 p-[6px]"
              onSubmit={(e) => {
                e.preventDefault()
                void rename()
              }}
            >
              <label htmlFor="renomear-whatsapp" className="text-[11.5px] text-light-neutral-500">
                Nome do negócio deste WhatsApp
              </label>
              <input id="renomear-whatsapp" className="pc-input" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
              <div className="flex justify-end gap-2">
                <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setMode('menu')}>
                  Cancelar
                </button>
                <button type="submit" disabled={busy || !name.trim()} className="pc-btn pc-btn-primary !text-[12px]">
                  {busy ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          )}

          {mode === 'disconnect' && (
            <div className="flex flex-col gap-2 p-[6px]">
              <div className="text-[12.5px] font-medium">Desconectar este WhatsApp?</div>
              <div className="text-[11.5px] leading-[1.4] text-light-neutral-500">
                A IA, o follow-up e os disparos deste número serão desligados. As conversas continuam salvas.
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setMode('menu')}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="pc-btn pc-btn-primary !text-[12px]"
                  onClick={() => {
                    close()
                    void disconnect()
                  }}
                >
                  Desconectar
                </button>
              </div>
            </div>
          )}

          {mode === 'switch' && (
            <div className="flex flex-col gap-2 p-[6px]">
              <div className="text-[12.5px] font-medium">{toOficial ? 'Trocar para a API oficial?' : 'Trocar para a conexão rápida?'}</div>
              <div className="text-[11.5px] leading-[1.4] text-light-neutral-500">
                {connected ? 'O WhatsApp será desconectado e você escolhe o novo tipo de conexão em seguida. ' : 'Você escolhe o novo tipo de conexão em seguida. '}
                As conversas continuam salvas.
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setMode('menu')}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="pc-btn pc-btn-primary !text-[12px]"
                  onClick={() => {
                    close()
                    void disconnect()
                  }}
                >
                  Continuar
                </button>
              </div>
            </div>
          )}

          {mode === 'archive' && (
            <div className="flex flex-col gap-2 p-[6px]">
              <div className="text-[12.5px] font-medium">Arquivar este WhatsApp?</div>
              <div className="text-[11.5px] leading-[1.4] text-light-neutral-500">
                Ele sai do menu e deixa de contar no limite do plano. Nada é apagado.
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setMode('menu')}>
                  Cancelar
                </button>
                <button type="button" disabled={busy} className="pc-btn pc-btn-primary !text-[12px]" onClick={() => void archive()}>
                  {busy ? 'Arquivando…' : 'Arquivar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
