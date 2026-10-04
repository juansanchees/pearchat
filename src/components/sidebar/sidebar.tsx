'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AddressBook,
  ArrowRight,
  Camera,
  CaretRight,
  ClockClockwise,
  CloudCheck,
  CrownSimple,
  ChartBar,
  GearSix,
  GoogleLogo,
  Hand,
  LockSimple,
  Plus,
  PaperPlaneTilt,
  Power,
  SignOut,
  X,
  Sparkle,
  WhatsappLogo,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { AutomationKey } from '@/lib/types'
import { useAppState } from '@/components/app/app-state'
import { AUTOMATION_KEYS, AUTOMATION_TITLES, DRAWER_DESCRIPTIONS, fmtNum } from '@/components/app/automations'
import { useShell } from '@/components/app/shell-context'
import { useDisconnect } from '@/components/app/use-disconnect'
import { useSpaceActions } from '@/components/app/use-spaces'
import { Logo } from '@/components/brand/logo'
import { useLogout } from '@/components/app/use-logout'
import { usePhotoPicker } from '@/components/app/use-photo-picker'
import { useDrawerData } from '@/components/drawers/drawer-data'
import { PearSwitch, Tag, initials } from '@/components/pear'
import { useSidebarData } from './use-sidebar-data'

const ICONS: Record<AutomationKey, Icon> = { ia: Sparkle, disparos: PaperPlaneTilt, followup: ClockClockwise }

const sectionLabel = 'text-[10.5px] font-medium uppercase leading-none tracking-[0.14em] text-dark-neutral-500'

export function Sidebar() {
  const pathname = usePathname()
  const { wa, connected, automations, setAutomation, openDrawer, closeDrawer, drawer, user, agentName, fuQueueCount, spaces, workspaceId } = useAppState()
  const { switchTo, create, limitReached, busy: spaceBusy } = useSpaceActions()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const newNameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (adding) newNameRef.current?.focus()
  }, [adding])
  const { campanhas, plano } = useDrawerData()
  const { menuOpen, setMenuOpen } = useShell()
  const { contatos, agenda } = useSidebarData()
  const disconnect = useDisconnect()
  const { logout, leaving } = useLogout()
  const photo = usePhotoPicker()

  // Navegar ou abrir uma gaveta fecha o menu (modo gaveta).
  const closeMenu = () => setMenuOpen(false)
  const goTo = () => {
    closeDrawer()
    closeMenu()
  }
  const openDrawerKey: typeof openDrawer = (key) => {
    openDrawer(key)
    closeMenu()
  }

  const onWhatsapp = pathname === '/' || pathname.startsWith('/whatsapp')
  const onAgenda = pathname.startsWith('/agenda')
  const onContatos = pathname.startsWith('/contatos')

  // Mini-calendário: dia atual (spec traz valores fixos; atualizamos após montar).
  const [today, setToday] = useState({ mes: 'OUT', dia: '2' })
  useEffect(() => {
    const d = new Date()
    setToday({ mes: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(), dia: String(d.getDate()) })
  }, [])

  const agendaText =
    agenda.state === 'conectado'
      ? agenda.hoje === 0
        ? 'Nada marcado hoje'
        : `${agenda.hoje} hoje${agenda.proximo ? ` · próximo ${agenda.proximo}` : ''}`
      : agenda.state === 'desconectado'
        ? 'Conectar Google Agenda'
        : 'Carregando…'

  // Subtítulo do cartão de um WhatsApp: tipo de conexão e número, ou "Desconectado". O ativo usa o estado ao vivo.
  const cardSub = (provider: 'oficial' | 'rapida' | null, status: string, numero: string | null) =>
    status !== 'conectado' ? 'Desconectado' : `${provider === 'oficial' ? 'Oficial' : 'Conexão rápida'}${numero ? ` · ${numero}` : ''}`

  const sending = campanhas.find((c) => c.status === 'Enviando')
  const agendadas = campanhas.filter((c) => c.status === 'Agendada' || c.status === 'Na fila').length
  const onCount = AUTOMATION_KEYS.filter((k) => automations[k]).length

  function subtitle(key: AutomationKey, on: boolean): string {
    if (!connected) return 'Bloqueado · toque para ver'
    if (key === 'ia') return on ? `${agentName} está respondendo` : 'Desligado · toque para configurar'
    if (key === 'followup') return on ? `${fuQueueCount} ${fuQueueCount === 1 ? 'contato' : 'contatos'} na fila` : 'Desligado · toque para configurar'
    if (sending) return `Enviando · ${sending.enviadas}/${sending.total}`
    if (!on) return 'Pausado'
    if (agendadas > 0) return `${agendadas} ${agendadas === 1 ? 'campanha agendada' : 'campanhas agendadas'}`
    return 'Pronto para enviar'
  }

  return (
    <aside
      aria-label="Menu lateral"
      className={cn(
        'flex w-[288px] flex-none flex-col overflow-y-auto overflow-x-hidden border-r border-dark-divider bg-[linear-gradient(180deg,#12251a_0%,#14170f_40%)] text-[13.5px] text-dark-text',
        'max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-0 max-[899px]:z-40 max-[899px]:w-[min(288px,88vw)] max-[899px]:shadow-[0_0_40px_rgba(0,0,0,0.6)] max-[899px]:transition-transform max-[899px]:duration-200',
        menuOpen ? 'max-[899px]:translate-x-0' : 'max-[899px]:-translate-x-full max-[899px]:invisible',
      )}
    >
      {/* 1. Marca */}
      <div className="flex h-[60px] flex-none items-center gap-[10px] px-[18px]">
        <Logo theme="dark" height={42} className="-ml-1" priority />
        <div className="flex-1" />
        <button
          type="button"
          onClick={closeMenu}
          aria-label="Fechar menu"
          className="grid h-8 w-8 flex-none place-items-center rounded-md p-0 text-dark-neutral-400 hover:bg-dark-neutral-900 min-[900px]:hidden"
        >
          <X size={16} />
        </button>
      </div>

      {/* 2. Cartões dos WhatsApps (um por espaço) + "Adicionar WhatsApp" */}
      <div className="flex flex-col gap-2 px-4 pb-0 pt-[6px]">
        {spaces.espacos.map((sp) => {
          const active = sp.id === workspaceId
          const live = active ? { provider: wa.provider, status: wa.status, numero: wa.numero } : sp
          const isConnected = live.status === 'conectado'
          const className = cn(
            'flex w-full items-center gap-[11px] rounded-lg border bg-dark-surface p-[13px] text-left text-dark-text hover:border-dark-accent-600',
            active ? (onWhatsapp ? 'border-dark-accent-500 bg-[color-mix(in_srgb,#5ccb6e_14%,#1d2117)]' : 'border-dark-accent-700') : 'border-dark-divider',
          )
          const body = (
            <>
              <span className="grid h-9 w-9 flex-none place-items-center rounded-pill border border-dark-accent-700 bg-dark-accent-900">
                <WhatsappLogo size={18} className="text-dark-accent-300" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-[1.25]">{active ? user.empresa : sp.nome}</span>
                <span className="mt-[2px] block truncate text-[11.5px] text-dark-neutral-400">
                  {cardSub(live.provider, live.status, live.numero)}
                </span>
              </span>
              {!active && (sp.unread > 0 || sp.handoffs > 0) && (
                <span
                  className="flex flex-none items-center gap-[3px] rounded-pill bg-dark-accent-500 px-[6px] py-[1px] text-[10.5px] font-medium leading-[1.5] text-dark-accent-900"
                  title={`${sp.unread} não ${sp.unread === 1 ? 'lida' : 'lidas'}${sp.handoffs > 0 ? ` · ${sp.handoffs} aguardando você` : ''}`}
                >
                  {sp.handoffs > 0 && <Hand size={10} weight="fill" aria-hidden />}
                  {sp.unread > 0 ? (sp.unread > 99 ? '99+' : sp.unread) : sp.handoffs}
                </span>
              )}
              <span
                className={cn('h-2 w-2 flex-none animate-zfPulse rounded-pill', isConnected ? 'bg-dark-accent-400' : 'bg-dark-neutral-600')}
                style={{ animationDuration: '2.4s' }}
                aria-hidden
              />
            </>
          )
          return active ? (
            <Link key={sp.id} href="/whatsapp" aria-current={onWhatsapp ? 'page' : undefined} onClick={goTo} className={className}>
              {body}
            </Link>
          ) : (
            <button key={sp.id} type="button" disabled={spaceBusy} onClick={() => void switchTo(sp.id)} className={className} title={`Trocar para ${sp.nome}`}>
              {body}
            </button>
          )
        })}

        {adding ? (
          <form
            className="flex flex-col gap-2 rounded-lg border border-dashed border-dark-neutral-700 p-[11px]"
            onSubmit={(e) => {
              e.preventDefault()
              const nome = newName.trim()
              if (nome && !spaceBusy) void create(nome)
            }}
          >
            <label className="text-[11.5px] text-dark-neutral-400" htmlFor="novo-whatsapp-nome">
              Nome do negócio deste WhatsApp
            </label>
            <input
              id="novo-whatsapp-nome"
              ref={newNameRef}
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAdding(false)
              }}
              placeholder="Ex.: Loja do Centro"
              className="w-full rounded-md border border-dark-divider bg-dark-bg px-[10px] py-[7px] text-[13px] text-dark-text outline-none placeholder:text-dark-neutral-600 focus:border-dark-accent-600"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={spaceBusy || !newName.trim()}
                className="flex-1 rounded-md border border-dark-accent-600 bg-dark-accent-900 px-3 py-[6px] text-[12px] font-medium text-dark-accent-200 hover:bg-dark-accent-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {spaceBusy ? 'Criando…' : 'Criar e conectar'}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-md border border-transparent bg-transparent px-3 py-[6px] text-[12px] text-dark-neutral-400 hover:bg-dark-neutral-900"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (spaces.espacos.length >= spaces.limite) {
                limitReached(spaces.limite)
                closeMenu()
                return
              }
              setNewName('')
              setAdding(true)
            }}
            className="flex w-full items-center gap-[11px] rounded-lg border border-dashed border-dark-neutral-700 bg-transparent p-[13px] text-left text-dark-neutral-300 hover:border-dark-accent-600 hover:text-dark-text"
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-pill border border-dashed border-dark-neutral-700">
              <Plus size={16} className="text-dark-neutral-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-[1.25]">Adicionar WhatsApp</span>
              <span className="mt-[2px] block truncate text-[11.5px] text-dark-neutral-500">
                {spaces.espacos.length} de {spaces.limite} no seu plano
              </span>
            </span>
          </button>
        )}
      </div>

      {/* 3. Cabeçalho Automações */}
      <div className="flex items-baseline justify-between px-[18px] pb-[10px] pt-[22px]">
        <span className={sectionLabel}>Automações</span>
        <span className="text-[11px] text-dark-neutral-500">{connected ? `${onCount} de 3 ligadas` : ''}</span>
      </div>

      {/* 4. Linhas de automação */}
      <div className="flex flex-col gap-2 px-4">
        {AUTOMATION_KEYS.map((key) => {
          const on = connected && automations[key]
          const Ico = ICONS[key]
          const title = AUTOMATION_TITLES[key]
          return (
            <div
              key={key}
              className={cn(
                'flex items-center gap-[10px] rounded-lg border px-3 py-[11px] transition-[background-color,border-color] duration-200',
                on ? 'border-dark-accent-700 bg-[color-mix(in_srgb,#5ccb6e_12%,#1d2117)]' : 'border-dark-divider bg-dark-surface',
              )}
            >
              <button
                type="button"
                onClick={() => openDrawerKey(key)}
                title={DRAWER_DESCRIPTIONS[key]}
                className="flex min-w-0 flex-1 items-center gap-[11px] bg-transparent p-0 text-left text-dark-text"
              >
                <span
                  className={cn(
                    'grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] transition-colors duration-200',
                    on ? 'bg-dark-accent-800 text-dark-accent-200' : 'bg-dark-neutral-900 text-dark-neutral-400',
                  )}
                >
                  <Ico size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-[6px]">
                    <span className="truncate text-[13px] font-medium leading-[1.25]">{title}</span>
                    {key === 'followup' && <Tag tone="outline" theme="dark" className="flex-none !px-[5px] !py-px !text-[9px]">Novo</Tag>}
                  </span>
                  <span className={cn('mt-[3px] block truncate text-[11px]', on ? 'text-dark-accent-300' : 'text-dark-neutral-500')}>
                    {subtitle(key, on)}
                  </span>
                </span>
              </button>
              {connected ? (
                <PearSwitch size="sm" tone="dark" checked={on} label={title} onChange={(next) => void setAutomation(key, next)} />
              ) : (
                <button
                  type="button"
                  title="Conecte o WhatsApp para ligar"
                  aria-label={`${title}: conecte o WhatsApp para ligar`}
                  onClick={() => void setAutomation(key, true)}
                  className="grid h-[22px] w-[38px] flex-none place-items-center rounded-pill border border-dashed border-dark-neutral-700 bg-transparent p-0"
                >
                  <LockSimple size={12} className="text-dark-neutral-500" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 5. Aviso de bloqueio */}
      {!connected && (
        <div className="flex gap-[7px] px-5 pt-3 text-[11.5px] text-dark-neutral-500 [text-wrap:pretty]">
          <LockSimple size={13} className="mt-px flex-none" />
          <span>Você já pode ver e configurar. Para ligar, conecte o WhatsApp.</span>
        </div>
      )}

      {/* 6. Agenda */}
      <div className="px-4 pt-5">
        <div className={cn(sectionLabel, 'pb-[10px] pl-[2px]')}>Agenda</div>
        <Link
          href="/agenda"
          aria-current={onAgenda ? 'page' : undefined}
          onClick={goTo}
          className={cn(
            'group relative flex w-full items-center gap-[13px] overflow-hidden rounded-lg border bg-[linear-gradient(135deg,color-mix(in_srgb,#5ccb6e_26%,#1d2117)_0%,#1d2117_70%)] px-[13px] py-3 text-left text-dark-text transition-[border-color,box-shadow] duration-200',
            onAgenda
              ? 'border-dark-accent-500 shadow-[0_0_0_1px_#25703c,0_8px_26px_color-mix(in_srgb,#5ccb6e_26%,transparent)]'
              : 'border-dark-accent-700 hover:border-dark-accent-500 hover:shadow-[0_0_0_1px_#1e4a2e,0_8px_24px_color-mix(in_srgb,#5ccb6e_22%,transparent)]',
          )}
        >
          <span
            aria-hidden
            className="absolute -right-[18px] -top-[18px] h-[74px] w-[74px] rounded-pill bg-[radial-gradient(circle,color-mix(in_srgb,#5ccb6e_35%,transparent),transparent_70%)]"
          />
          <span className="relative flex h-[50px] w-[46px] flex-none flex-col overflow-hidden rounded-[10px] border border-dark-accent-600 bg-dark-bg">
            <span className="h-[15px] bg-dark-accent-500 text-center text-[9px] font-semibold leading-[15px] tracking-[0.14em] text-dark-accent-900">{today.mes}</span>
            <span className="grid flex-1 place-items-center text-[20px] font-medium leading-none text-dark-text">{today.dia}</span>
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-[1.2]">Agenda</span>
            <span className="mt-1 flex items-center gap-[6px] text-[11.5px] text-dark-accent-300">
              <GoogleLogo size={12} className="flex-none" />
              <span className="truncate">{agendaText}</span>
            </span>
          </span>
          <span className="relative grid h-[26px] w-[26px] flex-none place-items-center rounded-pill border border-dark-accent-700">
            <ArrowRight size={12} className="text-dark-accent-300" />
          </span>
        </Link>
      </div>

      {/* 7. Contatos */}
      <div className="px-4 pt-[10px]">
        <Link
          href="/contatos"
          aria-current={onContatos ? 'page' : undefined}
          onClick={goTo}
          className={cn(
            'flex w-full items-center gap-[13px] rounded-lg border px-[13px] py-3 text-left text-dark-text transition-[border-color,background-color] duration-200 hover:border-dark-accent-600',
            onContatos ? 'border-dark-accent-500 bg-[color-mix(in_srgb,#5ccb6e_14%,#1d2117)]' : 'border-dark-divider bg-dark-surface',
          )}
        >
          <span className="relative grid h-[46px] w-[46px] flex-none place-items-center rounded-[12px] border border-dark-accent-700 bg-dark-bg">
            <AddressBook size={21} className="text-dark-accent-300" />
            <span className="absolute -bottom-[5px] -right-[5px] grid h-5 w-5 place-items-center rounded-pill border-2 border-dark-bg bg-dark-accent-500">
              <CloudCheck size={10} weight="fill" className="text-dark-accent-900" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium leading-[1.2]">Contatos</span>
            <span className="mt-1 block truncate text-[11.5px] text-dark-neutral-400">{fmtNum(contatos)} {contatos === 1 ? 'salvo' : 'salvos'} na nuvem</span>
          </span>
          <CaretRight size={13} className="flex-none text-dark-neutral-500" />
        </Link>
      </div>

      {/* 8. Espaçador */}
      <div className="flex-[1_0_16px]" />

      {/* 9. Navegação de conta */}
      <nav className="mt-3 flex flex-col gap-[2px] border-t border-dark-divider px-4 pb-1 pt-3" aria-label="Conta">
        {(
          [
            { key: 'resultados', label: 'Resultados', Ico: ChartBar, tag: null },
            { key: 'config', label: 'Configurações', Ico: GearSix, tag: null },
            { key: 'plano', label: 'Plano e pagamento', Ico: CrownSimple, tag: plano },
          ] as const
        ).map(({ key, label, Ico, tag }) => (
          <button
            key={key}
            type="button"
            onClick={() => openDrawerKey(key)}
            className={cn(
              'flex w-full items-center gap-[11px] rounded-md px-[10px] py-2 text-left text-[13px] hover:bg-dark-neutral-900',
              drawer === key ? 'bg-dark-accent-900 text-dark-accent-200' : 'bg-transparent text-dark-neutral-300',
            )}
          >
            <Ico size={16} />
            <span className="flex-1">{label}</span>
            {tag && <Tag theme="dark" className="!text-[10px]">{tag}</Tag>}
          </button>
        ))}
      </nav>

      {/* 10. Rodapé do usuário */}
      <div className="flex items-center gap-[10px] px-4 pb-4 pt-2">
        {photo.input}
        <button
          type="button"
          title="Trocar foto"
          aria-label="Trocar foto"
          onClick={photo.open}
          aria-busy={photo.uploading}
          className={cn(
            'relative grid h-9 w-9 flex-none place-items-center rounded-pill border border-dark-accent-700 bg-dark-accent-800 p-0 text-[12px] font-medium leading-none text-dark-accent-200 hover:border-dark-accent-400',
            photo.uploading && 'animate-pulse opacity-60',
          )}
        >
          {user.fotoUrl ? (
            <span className="block h-full w-full rounded-pill bg-cover bg-center" style={{ backgroundImage: `url(${user.fotoUrl})` }} />
          ) : (
            initials(user.nome)
          )}
          <span className="absolute -bottom-[3px] -right-[3px] grid h-4 w-4 place-items-center rounded-pill border-2 border-dark-bg bg-dark-accent-500">
            <Camera size={8} weight="fill" className="text-dark-accent-900" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium leading-[1.25]">{user.nome}</div>
          <div className="truncate text-[11px] text-dark-neutral-500">
            {user.organizacao} · Plano {plano}
          </div>
        </div>
        <button
          type="button"
          title="Sair da conta"
          aria-label="Sair da conta"
          disabled={leaving}
          onClick={() => void logout()}
          className="grid h-8 w-8 flex-none place-items-center rounded-md p-0 text-dark-neutral-400 hover:bg-[color-mix(in_srgb,#5ccb6e_10%,transparent)] disabled:opacity-60"
        >
          <Power size={15} />
        </button>
        {connected && (
          <button
            type="button"
            title="Desconectar WhatsApp"
            aria-label="Desconectar WhatsApp"
            onClick={() => void disconnect()}
            className="grid h-8 w-8 flex-none place-items-center rounded-md p-0 text-dark-accent-500 hover:bg-[color-mix(in_srgb,#5ccb6e_10%,transparent)]"
          >
            <SignOut size={15} />
          </button>
        )}
      </div>
    </aside>
  )

}
