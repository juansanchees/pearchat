'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellSimple, Checks, Clock } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { Spinner } from '@/components/pear'
import { RETENCAO_DIAS } from '@/server/notifications/types'
import type { NotificationDTO } from '@/server/notifications/types'
import { NotificationItem } from './notification-item'
import { agruparPorDia, desdeLabel } from './time'
import { useNotifications } from './use-notifications'

/** Só rotas internas (o servidor já gera assim; aqui é a segunda trava): começa com uma barra e não é "//host". */
const linkSeguro = (l: string | null): string | null => (l && /^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(l) ? l : null)

/**
 * Sininho do app (canto superior direito de todas as telas internas): selo de não lidas, painel suspenso com o histórico
 * de 7 dias, bloco "Enquanto você esteve fora" e aviso ao voltar para a aba. Montado UMA vez, no AppShell.
 */
export function NotificationBell() {
  const { toast } = useAppState()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [destacados, setDestacados] = useState<string[]>([])
  const [agoraMs, setAgoraMs] = useState(() => Date.now())
  const raiz = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)
  const painelId = useId()

  const abrirRef = useRef<() => void>(() => undefined)
  const n = useNotifications(({ resumo }) => {
    // Sem som e sem notificação do navegador: só este aviso curto, com ação para abrir o painel.
    toast({
      icon: <Bell size={18} weight="fill" />,
      title: 'Enquanto você esteve fora',
      text: resumo,
      action: { label: 'Ver', onClick: () => abrirRef.current() },
    })
  })
  const { itens, naoLidas, carregado, falhou, sync, marcarLidas, apagar, limpar } = n

  const abrir = useCallback(() => {
    setOpen(true)
    setAgoraMs(Date.now())
    void sync(true)
  }, [sync])
  abrirRef.current = abrir
  const fechar = useCallback((devolverFoco = false) => {
    setOpen(false)
    setConfirmando(false)
    setDestacados([])
    if (devolverFoco) botao.current?.focus()
  }, [])

  // Painel aberto: relógio dos "há 5 min", foco, Esc e clique fora.
  useEffect(() => {
    if (!open) return
    const t = window.setInterval(() => setAgoraMs(Date.now()), 30_000)
    painel.current?.focus()
    const aoClicar = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) fechar()
    }
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fechar(true)
      }
    }
    document.addEventListener('mousedown', aoClicar)
    document.addEventListener('keydown', aoTecla)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('mousedown', aoClicar)
      document.removeEventListener('keydown', aoTecla)
    }
  }, [open, fechar])

  // Abrir marca os itens como lidos após um instante (o selo some logo; a bolinha de "nova" fica até fechar o painel).
  useEffect(() => {
    if (!open) return
    const naoLidos = itens.filter((i) => !i.lida).map((i) => i.id)
    if (naoLidos.length === 0) return
    setDestacados((cur) => Array.from(new Set(cur.concat(naoLidos))))
    const t = window.setTimeout(() => void marcarLidas(naoLidos), 1200)
    return () => window.clearTimeout(t)
  }, [open, itens, marcarLidas])

  const abrirItem = useCallback(
    (item: NotificationDTO) => {
      if (!item.lida) void marcarLidas([item.id])
      const destino = linkSeguro(item.link)
      fechar()
      if (destino) router.push(destino)
    },
    [fechar, marcarLidas, router],
  )

  const temAlta = itens.some((i) => !i.lida && i.prioridade === 'alta')
  const marcados = useMemo(() => new Set(destacados), [destacados])

  // Bloco "Enquanto você esteve fora": o que ainda é novidade (não lido ou destacado) e aconteceu com a pessoa fora.
  const aoVivo = (i: NotificationDTO) => !i.lida || marcados.has(i.id)
  const fora = itens.filter((i) => i.ausente && aoVivo(i))
  const resto = itens.filter((i) => !(i.ausente && aoVivo(i)))
  const desde = fora.reduce<string | null>((m, i) => {
    const d = i.dados?.ausenteDesde
    return d && (!m || d < m) ? d : m
  }, null)
  const grupos = useMemo(() => agruparPorDia(resto, agoraMs), [resto, agoraMs])

  // Anúncio para leitor de tela quando chegam notificações novas.
  const [anuncio, setAnuncio] = useState('')
  const anterior = useRef(0)
  useEffect(() => {
    if (naoLidas > anterior.current) setAnuncio(naoLidas === 1 ? '1 notificação não lida' : `${naoLidas} notificações não lidas`)
    anterior.current = naoLidas
  }, [naoLidas])

  const rotuloBotao = naoLidas > 0 ? `Notificações, ${naoLidas} ${naoLidas === 1 ? 'não lida' : 'não lidas'}` : 'Notificações'

  return (
    <div ref={raiz} className="absolute right-3 top-3 z-20">
      <button
        ref={botao}
        type="button"
        aria-label={rotuloBotao}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? painelId : undefined}
        title="Notificações"
        onClick={() => (open ? fechar() : abrir())}
        className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-light-divider bg-light-surface p-0 text-light-text hover:bg-[rgba(29,33,23,.07)]"
      >
        <Bell size={16} weight={naoLidas > 0 ? 'fill' : 'regular'} aria-hidden="true" />
        {naoLidas > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-[5px] -top-[5px] grid h-[15px] min-w-[15px] place-items-center rounded-pill bg-light-accent-fill px-[3px] text-[9.5px] font-semibold leading-none text-white shadow-[0_0_0_2px_#ffffff]"
          >
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        ) : null}
        {temAlta ? <span aria-hidden="true" className="absolute -left-[3px] -top-[3px] h-[9px] w-[9px] rounded-pill bg-[#b0872f] shadow-[0_0_0_2px_#ffffff]" /> : null}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {anuncio}
      </span>

      {open ? (
        <div
          ref={painel}
          id={painelId}
          role="dialog"
          aria-modal="false"
          aria-label="Notificações"
          tabIndex={-1}
          onBlur={(e) => {
            // Foco saiu do painel pelo teclado (Tab): fecha. Clique fora já é tratado acima.
            const para = e.relatedTarget as Node | null
            if (para && raiz.current && !raiz.current.contains(para)) fechar()
          }}
          className="absolute right-0 top-[40px] flex max-h-[min(560px,calc(100vh-88px))] w-[380px] max-w-[calc(100vw-24px)] animate-zfIn flex-col overflow-hidden rounded-lg border border-solid border-light-divider bg-light-surface text-light-text shadow-[0_12px_32px_rgba(0,0,0,.28)] focus:outline-none focus-visible:!outline-none"
        >
          <div className="flex flex-none items-center gap-2 border-0 border-b border-solid border-light-divider px-4 py-3">
            <h2 className="m-0 flex-1 text-[14px] font-medium leading-tight">Notificações</h2>
            {itens.some((i) => !i.lida) ? (
              <button type="button" onClick={() => void marcarLidas()} className="pc-btn pc-btn-ghost !px-2 !py-1 !text-[11.5px]">
                <Checks size={14} aria-hidden="true" />
                Marcar todas como lidas
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!carregado ? (
              <div className="grid place-items-center py-10">
                <Spinner size={24} />
              </div>
            ) : itens.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
                  <BellSimple size={22} />
                </span>
                <p className="m-0 text-[13.5px] font-medium">{falhou ? 'Não foi possível carregar' : 'Nada novo por aqui'}</p>
                <p className="m-0 max-w-[260px] text-[11.5px] leading-relaxed text-light-neutral-500">
                  {falhou ? 'Verifique sua conexão. Tentamos de novo em instantes.' : 'O que acontecer enquanto você estiver em outra tela, ou fora, aparece aqui.'}
                </p>
              </div>
            ) : (
              <>
                {fora.length > 0 ? (
                  <section aria-label="Enquanto você esteve fora" className="border-0 border-b border-solid border-light-divider bg-light-bg">
                    <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-3 text-[10.5px] font-medium uppercase tracking-[.12em] text-light-neutral-500">
                      <Clock size={12} aria-hidden="true" />
                      <span>Enquanto você esteve fora</span>
                      {desde ? <span className="font-normal normal-case tracking-normal">· desde {desdeLabel(desde, agoraMs)}</span> : null}
                    </div>
                    <ul className="m-0 p-0">
                      {fora.map((i) => (
                        <NotificationItem key={i.id} n={i} agoraMs={agoraMs} destacada={aoVivo(i)} onAbrir={abrirItem} onApagar={(x) => void apagar(x.id)} />
                      ))}
                    </ul>
                  </section>
                ) : null}
                {grupos.map((g) => (
                  <section key={g.rotulo} aria-label={g.rotulo}>
                    <div className="px-4 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-[.12em] text-light-neutral-500">{g.rotulo}</div>
                    <ul className="m-0 p-0">
                      {g.itens.map((i) => (
                        <NotificationItem key={i.id} n={i} agoraMs={agoraMs} destacada={aoVivo(i)} onAbrir={abrirItem} onApagar={(x) => void apagar(x.id)} />
                      ))}
                    </ul>
                  </section>
                ))}
              </>
            )}
          </div>

          <div className="flex-none border-0 border-t border-solid border-light-divider px-4 py-2.5">
            {confirmando ? (
              <div className="flex flex-col gap-2">
                <div className="text-[12.5px] font-medium">Limpar todo o histórico?</div>
                <div className="text-[11.5px] leading-[1.4] text-light-neutral-500">As notificações apagadas não voltam. As conversas e a agenda não mudam.</div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => setConfirmando(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="pc-btn pc-btn-primary !text-[12px]"
                    onClick={() => {
                      setConfirmando(false)
                      void limpar()
                    }}
                  >
                    Limpar histórico
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[10.5px] leading-snug text-light-neutral-500">O histórico é guardado por {RETENCAO_DIAS} dias</span>
                {itens.length > 0 ? (
                  <button type="button" className="pc-btn pc-btn-ghost !px-2 !py-1 !text-[11.5px]" onClick={() => setConfirmando(true)}>
                    Limpar histórico
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
