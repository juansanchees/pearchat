'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, GoogleLogo, WhatsappLogo } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { useDisconnect } from '@/components/app/use-disconnect'
import { usePhotoPicker } from '@/components/app/use-photo-picker'
import { Avatar, Pill } from '@/components/pear'
import type { SettingsDTO } from '@/lib/types'
import type { CalendarStateDto } from '@/server/calendar/types'
import { api } from './api'
import { useDrawerData, useDrawerLoad } from './drawer-data'
import { NOTIF_OPCOES } from './mock-data'
import { SegurancaSection } from './seguranca-section'
import { DrawerShell, Field, SaveFooter, Section } from './parts'

const connRow = 'flex items-center gap-3 rounded-md border border-light-divider px-[14px] py-3'

export function ConfigDrawer() {
  const { user, setUser, wa, connected, closeDrawer } = useAppState()
  const { horarioAtendimento, setHorarioAtendimento, notifs, setNotifs } = useDrawerData()
  const loading = useDrawerLoad('config')
  const photo = usePhotoPicker()
  const disconnect = useDisconnect()
  const router = useRouter()
  // Estado real da Google Agenda (a gaveta mostrava sempre "Não conectado").
  const [gcal, setGcal] = useState<{ conectado: boolean; email: string | null }>({ conectado: false, email: null })
  useEffect(() => {
    let alive = true
    fetch('/api/calendar', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<CalendarStateDto>) : null))
      .then((c) => {
        if (alive && c) setGcal({ conectado: c.conectado, email: c.email })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // A foto não é gravada aqui: ainda não há storage de arquivos (TODO: subir a imagem e salvar User.fotoUrl).
  const salvar = async () => {
    const saved = await api<SettingsDTO>('/api/settings', {
      method: 'PUT',
      body: { nome: user.nome, email: user.email, empresa: user.empresa, horarioAtendimento: horarioAtendimento, notifs },
    })
    setUser({ nome: saved.nome, email: saved.email, empresa: saved.empresa })
  }

  const waSub = !connected
    ? 'Escaneie o QR para começar'
    : `${wa.provider === 'oficial' ? 'Oficial' : 'Conexão rápida'}${wa.numero ? ` · ${wa.numero}` : ''}`

  return (
    <DrawerShell id="config" loading={loading} footer={<SaveFooter titulo="Configurações" onSave={salvar} />}>
      <Section label="Perfil" gap="gap-3">
        {photo.input}
        <div className="flex items-center gap-[14px]">
          <button type="button" title="Trocar foto" aria-label="Trocar foto" onClick={photo.open} className="rounded-pill p-0">
            <Avatar name={user.nome} size={56} src={user.fotoUrl} className="text-[17px]" />
          </button>
          <button type="button" className="pc-btn pc-btn-secondary !text-[12px]" onClick={photo.open}>
            <Camera size={14} />
            Trocar foto
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Seu nome" className="min-w-0 flex-[1_1_180px]">
            <input className="pc-input" value={user.nome} onChange={(e) => setUser({ nome: e.target.value })} />
          </Field>
          <Field label="E-mail" className="min-w-0 flex-[1_1_220px]">
            <input className="pc-input" type="email" value={user.email} onChange={(e) => setUser({ email: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section label="Este WhatsApp" gap="gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Nome do negócio" className="min-w-0 flex-[1_1_180px]">
            <input className="pc-input" value={user.empresa} onChange={(e) => setUser({ empresa: e.target.value })} />
          </Field>
          <Field label="Horário de atendimento" className="min-w-0 flex-[1_1_220px]">
            <input className="pc-input" value={horarioAtendimento} onChange={(e) => setHorarioAtendimento(e.target.value)} />
          </Field>
        </div>
        <div className="-mt-1 text-[11.5px] text-light-neutral-500">A IA usa esse horário quando a opção &quot;Fora do expediente&quot; estiver marcada.</div>
      </Section>

      <Section label="Me avisar quando">
        <div className="flex flex-wrap gap-2">
          {NOTIF_OPCOES.map((o) => (
            <Pill
              key={o}
              variant="chip"
              active={notifs.includes(o)}
              onClick={() => setNotifs((l) => (l.includes(o) ? l.filter((x) => x !== o) : [...l, o]))}
            >
              {o}
            </Pill>
          ))}
        </div>
      </Section>

      <Section label="Conexões">
        <div className={connRow}>
          <WhatsappLogo size={18} className="flex-none text-light-accent-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-[1.25]">WhatsApp</div>
            <div className="truncate text-[11.5px] text-light-neutral-500">{waSub}</div>
          </div>
          {connected && (
            <button type="button" className="pc-btn pc-btn-ghost !text-[12px]" onClick={() => void disconnect()}>
              Desconectar
            </button>
          )}
        </div>
        <div className={connRow}>
          <GoogleLogo size={18} className="flex-none text-light-accent-300" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-[1.25]">Google Agenda</div>
            <div className="truncate text-[11.5px] text-light-neutral-500">
              {gcal.conectado ? `Conectado${gcal.email ? ` · ${gcal.email}` : ''}` : 'Não conectado'}
            </div>
          </div>
          <button
            type="button"
            className="pc-btn pc-btn-secondary !text-[12px]"
            onClick={() => {
              closeDrawer()
              router.push('/agenda')
            }}
          >
            {gcal.conectado ? 'Abrir agenda' : 'Conectar'}
          </button>
        </div>
      </Section>

      <SegurancaSection />
    </DrawerShell>
  )
}
