'use client'

import { useEffect, useState } from 'react'
import { BookingPhone, ReminderCard, WeekAgenda } from '../mini/agenda-booking'
import { Broadcast, BROADCAST_TOTAL, ContactsPanel } from '../mini/broadcast-contacts'
import { AI_CHAT_FINAL, AiChat, FOLLOWUP_FINAL, FollowupChat, Inbox } from '../mini/conversations'
import { useStepper } from '../anim/use-play'

// Versões "vivas" das mini-interfaces das Funcionalidades. Cada uma roda a sua história em laço lento enquanto
// está na tela (pausa fora dela ou com a aba oculta) e, com movimento reduzido ou sem JavaScript, mostra o estado final.
// As durações ficam fora dos componentes (referência estável para o temporizador).

const AI_DUR = [500, 1500, 1300, 1800, 1400, 1300, 5200]
export function AiChatLive({ className }: { className?: string }) {
  const { ref, step, fading } = useStepper<HTMLDivElement>({ durations: AI_DUR, final: AI_CHAT_FINAL })
  return (
    <div ref={ref} className={className}>
      <AiChat step={step} fading={fading} />
    </div>
  )
}

/* Agenda: o celular avança serviço → dia → horário → confirmar; o agendamento aparece na grade com "Novo agendamento";
   o lembrete sai, a cliente responde "1" e a etiqueta vira "Confirmado". */
const AGENDA_DUR = [1200, 900, 900, 1300, 1800, 1500, 1100, 5200]
const PHONE = [0, 1, 2, 3, 4, 4, 4, 4]
const REMINDER = [-1, -1, -1, -1, -1, 0, 1, 2]
export function AgendaLive() {
  const { ref, step } = useStepper<HTMLDivElement>({ durations: AGENDA_DUR })
  return (
    <div ref={ref}>
      <WeekAgenda fresh={step >= 4} confirmed={step >= 7} />
      <div className="mt-6 flex flex-col items-center gap-6 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-center min-[1100px]:mt-0">
        <BookingPhone step={PHONE[step]} className="w-[290px] flex-none min-[1100px]:absolute min-[1100px]:-top-10 min-[1100px]:right-0" />
        <ReminderCard step={REMINDER[step]} className="w-[min(330px,100%)] min-[1100px]:absolute min-[1100px]:-bottom-12 min-[1100px]:-left-8" />
      </div>
    </div>
  )
}

const FU_DUR = [1300, 700, 700, 1100, 1200, 1500, 5200]
export function FollowupLive({ className }: { className?: string }) {
  const { ref, step, fading } = useStepper<HTMLDivElement>({ durations: FU_DUR, final: FOLLOWUP_FINAL })
  return (
    <div ref={ref} className={className}>
      <FollowupChat step={step} fading={fading} />
    </div>
  )
}

/* Conversas: uma conversa nova entra no topo da lista; o atendente digita "/" e o menu de respostas rápidas abre. */
const INBOX_DUR = [1400, 1600, 500, 1500, 1500, 3200]
export function InboxLive() {
  const { ref, step } = useStepper<HTMLDivElement>({ durations: INBOX_DUR, final: 4 })
  return (
    <div ref={ref}>
      <Inbox incoming={step >= 1} typed={step >= 2 ? '/' : ''} quickReplies={step >= 3 && step < 5} qrActive={step >= 4 ? 1 : 0} />
    </div>
  )
}

/* Avisos: rascunho → agendada → enviando (contagem) → concluída. */
const BC_DUR = [1500, 1700, 3400, 4200]
export function BroadcastLive() {
  const { ref, step, play } = useStepper<HTMLDivElement>({ durations: BC_DUR })
  const [sent, setSent] = useState(0)
  useEffect(() => {
    if (step !== 2) {
      setSent(step > 2 ? BROADCAST_TOTAL : 0)
      return
    }
    if (!play) return
    const t = window.setInterval(() => setSent((n) => Math.min(BROADCAST_TOTAL, n + 3)), 110)
    return () => window.clearInterval(t)
  }, [step, play])
  return (
    <div ref={ref}>
      <Broadcast step={step} sent={sent} />
    </div>
  )
}

/* Contatos: o filtro por etiqueta alterna devagar. */
const FILTROS = ['Todos', 'Lead', 'VIP', 'Agendamento', 'Cliente']
const CT_DUR = [2400, 2200, 2200, 2200, 2200]
export function ContactsLive() {
  const { ref, step } = useStepper<HTMLDivElement>({ durations: CT_DUR, final: 0 })
  return (
    <div ref={ref}>
      <ContactsPanel filter={FILTROS[step]} />
    </div>
  )
}
