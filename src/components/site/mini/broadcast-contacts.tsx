import { CalendarBlank, FileXls, MagnifyingGlass, Moon, PaperPlaneTilt, Timer, UsersThree } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { AppWindow, Avatar, MiniLabel, Switch, Tag } from '../ui/primitives'

/* ---------- Avisos para clientes (Disparos) ---------- */

/** 0 rascunho · 1 agendado para hoje, 18:00 · 2 enviando (com intervalo) · 3 concluído */
export const BROADCAST_FINAL = 3

export function Broadcast({ step = 1, className }: { step?: number; className?: string }) {
  const status = step >= 3 ? 'Enviada para 86 contatos' : step === 2 ? 'Enviando · 31 de 86' : step === 1 ? 'Para 86 contatos · hoje, 18:00' : 'Rascunho'
  return (
    <AppWindow title="Disparos" className={className} bodyClassName="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-light-accent-800 text-light-accent-200">
          <PaperPlaneTilt size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium leading-tight">Aviso de horário de feriado</div>
          <div className="mt-1 text-[11.5px] text-light-neutral-500">{status}</div>
        </div>
        <Tag tone={step >= 1 ? 'accent' : 'neutral'}>{step >= 3 ? 'Concluída' : step >= 1 ? 'Agendada' : 'Rascunho'}</Tag>
      </div>

      <div>
        <MiniLabel className="mb-2">Para quem enviar</MiniLabel>
        <div className="flex items-center gap-2.5 rounded-md border border-light-divider px-3 py-2.5">
          <UsersThree size={16} className="text-light-neutral-500" />
          <span className="flex-1 text-[12.5px]">Clientes ativos</span>
          <span className="text-[11.5px] text-light-neutral-500">86 contatos</span>
        </div>
      </div>

      <div>
        <MiniLabel className="mb-2">Mensagem</MiniLabel>
        <div className="rounded-md border border-light-divider bg-white px-3 py-2.5 text-[12.5px] leading-[1.5]">
          Oi, <span className="rounded-[4px] bg-light-accent-800 px-1 text-light-accent-200">{'{nome}'}</span>! Na segunda-feira, dia 12, por causa do feriado,
          vamos atender das 9h às 13h. Qualquer dúvida, é só chamar por aqui.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
        <div>
          <MiniLabel className="mb-2">Quando enviar</MiniLabel>
          <div className="flex items-center gap-2 rounded-md border border-light-divider px-3 py-2 text-[12px]">
            <CalendarBlank size={14} className="text-light-neutral-500" /> Agendar: hoje, 18:00
          </div>
        </div>
        <div>
          <MiniLabel className="mb-2">Intervalo entre mensagens</MiniLabel>
          <div className="flex items-center gap-2 rounded-md border border-light-divider px-3 py-2 text-[12px]">
            <Timer size={14} className="text-light-neutral-500" /> 15–30 s
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-md bg-light-bg px-3 py-2.5 text-[12px] text-light-neutral-400">
        <Moon size={15} className="flex-none" />
        <span className="flex-1">Horário de silêncio: não enviar entre 21:00 e 08:00</span>
        <Switch />
      </div>

      {step === 2 && (
        <div className="h-1.5 overflow-hidden rounded-pill bg-light-neutral-900">
          <div className="h-full w-[36%] rounded-pill bg-light-accent-fill" />
        </div>
      )}
    </AppWindow>
  )
}

/* ---------- Contatos ---------- */

const CONTATOS = [
  { nome: 'Mariana Silva', tel: '(11) 97412-0091', tags: ['Cliente', 'VIP'], quando: 'Hoje' },
  { nome: 'Rafael Costa', tel: '(11) 98765-4321', tags: ['Agendamento'], quando: 'Hoje' },
  { nome: 'Carlos Menezes', tel: '(11) 96610-3382', tags: ['Lead'], quando: 'Ontem' },
  { nome: 'Ana Paula Ribeiro', tel: '(11) 95527-1840', tags: ['Cliente'], quando: '3 dias' },
  { nome: 'Beatriz Sousa', tel: '(11) 98110-7742', tags: ['Lead'], quando: '1 semana' },
]

/** `filter` destaca uma etiqueta (a etapa 2 pode alternar filtros). */
export function ContactsPanel({ filter = 'Todos', className }: { filter?: string; className?: string }) {
  const rows = filter === 'Todos' ? CONTATOS : CONTATOS.filter((c) => c.tags.includes(filter))
  return (
    <AppWindow title="Contatos" className={className}>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-light-divider px-2.5 text-[12px] text-light-neutral-500">
          <MagnifyingGlass size={14} className="flex-none" /> <span className="truncate">Buscar por nome, número ou etiqueta</span>
        </div>
        <span className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-light-accent-500 px-3 text-[12px] font-medium text-light-accent-300">
          <FileXls size={15} /> Importar planilha
        </span>
      </div>
      <div className="flex gap-1.5 overflow-hidden px-4 pb-3">
        {['Todos', 'Cliente', 'Lead', 'Agendamento', 'VIP'].map((t) => (
          <span
            key={t}
            className={cn(
              'whitespace-nowrap rounded-pill border px-[10px] py-[4px] text-[11px]',
              t === filter ? 'border-light-accent-600 bg-light-accent-900 text-light-accent-200' : 'border-light-divider text-light-neutral-400',
            )}
          >
            {t}
          </span>
        ))}
      </div>
      {rows.map((c) => (
        <div key={c.nome} className="flex items-center gap-3 border-t border-light-divider px-4 py-3">
          <Avatar nome={c.nome} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium">{c.nome}</span>
              {c.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
            <div className="mt-0.5 text-[11.5px] text-light-neutral-500">{c.tel}</div>
          </div>
          <span className="hidden text-[11px] text-light-neutral-500 min-[400px]:inline">{c.quando}</span>
        </div>
      ))}
    </AppWindow>
  )
}
