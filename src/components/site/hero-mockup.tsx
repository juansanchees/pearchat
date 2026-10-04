import { CalendarDots, ChatCircleDots, Checks, Sparkle, UsersThree, PaperPlaneTilt } from '@phosphor-icons/react/dist/ssr'

// Composição estática (não é uma captura de tela) que imita a tela de Conversas do app: menu, lista e conversa.
const CONVERSAS = [
  { nome: 'Juliana Freitas', previa: 'Perfeito, quero para sábado de manhã.', hora: '09:52', ia: true, ativa: true },
  { nome: 'Carlos Menezes', previa: 'Qual o valor do bolo de 2 kg?', hora: '10:05', novas: 1 },
  { nome: 'Ana Paula Ribeiro', previa: 'Seria para umas 40 pessoas.', hora: '10:13', novas: 2 },
  { nome: 'Rodrigo Alves', previa: 'Recebi! Ficou lindo, obrigado.', hora: '09:20' },
]

function Avatar({ nome }: { nome: string }) {
  const ini = nome.split(' ').map((p) => p[0]).slice(0, 2).join('')
  return (
    <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-pill bg-light-accent-800 text-[12px] font-medium text-light-accent-200">
      {ini}
    </span>
  )
}

export function HeroMockup() {
  return (
    <div
      role="img"
      aria-label="Ilustração da tela de Conversas do PearChat: lista de conversas e uma conversa em que o agente de IA responde a um cliente."
      className="overflow-hidden rounded-xl border border-light-divider bg-light-surface shadow-lg"
    >
      <div className="flex items-center gap-1.5 border-b border-light-divider bg-light-bg px-3.5 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-pill bg-light-neutral-700" />
        <span className="h-2.5 w-2.5 rounded-pill bg-light-neutral-700" />
        <span className="h-2.5 w-2.5 rounded-pill bg-light-neutral-700" />
      </div>
      <div className="grid min-h-[360px] grid-cols-[52px_minmax(0,1fr)] min-[560px]:grid-cols-[52px_200px_minmax(0,1fr)]" aria-hidden="true">
        <nav className="flex flex-col items-center gap-3.5 bg-dark-bg py-4 text-dark-neutral-400">
          <ChatCircleDots size={20} weight="fill" className="text-dark-accent-400" />
          <CalendarDots size={20} />
          <UsersThree size={20} />
          <PaperPlaneTilt size={20} />
        </nav>

        <ul className="m-0 hidden list-none flex-col border-r border-light-divider p-0 min-[560px]:flex">
          {CONVERSAS.map((c) => (
            <li key={c.nome} className={`flex items-center gap-2.5 border-b border-light-divider px-3 py-3 ${c.ativa ? 'bg-light-accent-900' : ''}`}>
              <Avatar nome={c.nome} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[12.5px] font-medium">{c.nome}</span>
                  <span className="flex-none text-[10px] text-light-neutral-500">{c.hora}</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[11.5px] text-light-neutral-500">{c.previa}</span>
                  {c.novas && <span className="grid h-4 min-w-4 flex-none place-items-center rounded-pill bg-light-accent-fill px-1 text-[9.5px] font-medium text-white">{c.novas}</span>}
                  {c.ia && <Sparkle size={11} weight="fill" className="flex-none text-light-accent-400" />}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex min-w-0 flex-col bg-light-bg">
          <div className="flex items-center gap-2.5 border-b border-light-divider bg-light-surface px-4 py-3">
            <Avatar nome="Juliana Freitas" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium leading-tight">Juliana Freitas</div>
              <div className="text-[11px] text-light-neutral-500">Atendimento pela IA</div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-pill border border-light-accent-700 bg-light-accent-900 px-2.5 py-1 text-[11px] text-light-accent-300">
              <Sparkle size={11} weight="fill" /> IA ativa
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-2.5 p-4">
            <div className="max-w-[78%] self-start rounded-[12px_12px_12px_4px] border border-light-divider bg-light-surface px-[13px] py-2 text-[13px] leading-[1.45]">
              Vocês entregam no Tatuapé?
              <div className="mt-1 text-right text-[10px] text-light-neutral-500">09:40</div>
            </div>
            <div className="max-w-[86%] self-end rounded-[12px_12px_4px_12px] border border-light-accent-700 bg-light-accent-900 px-[13px] pb-[7px] pt-[9px] text-[13px] leading-[1.45]">
              <div className="mb-1.5 flex items-center gap-[5px] text-[10.5px] font-medium leading-none text-light-accent-300">
                <Sparkle size={10} weight="fill" /> Luna · IA
              </div>
              Entregamos sim! A taxa é R$ 12. Para qual dia você precisa?
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-light-neutral-500">
                09:40 <Checks size={13} className="text-light-accent-300" />
              </div>
            </div>
            <div className="max-w-[78%] self-start rounded-[12px_12px_12px_4px] border border-light-divider bg-light-surface px-[13px] py-2 text-[13px] leading-[1.45]">
              Perfeito, quero para sábado de manhã.
              <div className="mt-1 text-right text-[10px] text-light-neutral-500">09:52</div>
            </div>
            <div className="max-w-[86%] self-end rounded-[12px_12px_4px_12px] border border-light-accent-700 bg-light-accent-900 px-[13px] pb-[7px] pt-[9px] text-[13px] leading-[1.45]">
              <div className="mb-1.5 flex items-center gap-[5px] text-[10.5px] font-medium leading-none text-light-accent-300">
                <Sparkle size={10} weight="fill" /> Luna · IA
              </div>
              Sábado às 9h está livre. Posso confirmar o seu pedido?
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
