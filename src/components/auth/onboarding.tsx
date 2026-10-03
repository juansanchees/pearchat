'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AddressBook,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  CalendarDots,
  Cake,
  ChalkboardTeacher,
  Check,
  ClockClockwise,
  DotsThreeOutline,
  FirstAidKit,
  ForkKnife,
  HairDryer,
  Info,
  LockSimple,
  PaperPlaneTilt,
  PawPrint,
  Scissors,
  ShieldCheck,
  SignOut,
  Sparkle,
  Storefront,
  User,
  Warning,
  WhatsappLogo,
  Wrench,
  type Icon,
} from '@phosphor-icons/react'
import { sairAction } from '@/app/(auth)/bem-vindo/actions'
import { Logo } from '@/components/brand/logo'

// Interface do onboarding (4 passos) e da tela "Tudo pronto".
// Salva em POST /api/onboarding: nome da empresa, nome e tom do agente e (se o prompt estiver vazio) segmento e objetivos.
// Tamanho da equipe não tem coluna e não é salvo. A conexão do WhatsApp é feita de verdade em /whatsapp.

type SegId = 'beleza' | 'barbearia' | 'petshop' | 'saude' | 'restaurante' | 'confeitaria' | 'loja' | 'servicos' | 'outro'
type Tom = 'Amigável' | 'Profissional' | 'Direto'
type ObjId = 'ia' | 'disparos' | 'followup' | 'agenda'

const SEGS: { id: SegId; label: string; Icon: Icon; q: string; a: string; d: string }[] = [
  { id: 'beleza', label: 'Beleza e estética', Icon: HairDryer, q: 'Tem horário para escova amanhã?', a: 'Tenho às 10h e às 15h30. Qual horário fica melhor para você?', d: 'Tenho às 10h e às 15h30. Qual prefere?' },
  { id: 'barbearia', label: 'Barbearia', Icon: Scissors, q: 'Oi! Tem horário para corte hoje?', a: 'Tenho às 16h e às 18h30. Quer corte, barba ou os dois?', d: 'Tenho às 16h e às 18h30. Corte, barba ou os dois?' },
  { id: 'petshop', label: 'Pet shop', Icon: PawPrint, q: 'Oi! Quanto custa o banho para um cachorro pequeno?', a: 'O banho para porte pequeno sai por um valor fixo. Qual é a raça e quando você quer agendar?', d: 'Depende do porte. Qual a raça e quando quer agendar?' },
  { id: 'saude', label: 'Saúde e clínicas', Icon: FirstAidKit, q: 'Queria marcar uma consulta.', a: 'Claro! Qual dia e período ficam melhores para você?', d: 'Qual dia e período você prefere?' },
  { id: 'restaurante', label: 'Restaurante e delivery', Icon: ForkKnife, q: 'Boa noite, ainda dá para pedir delivery?', a: 'Dá sim, atendemos até as 23h. Quer que eu envie o cardápio?', d: 'Atendemos até as 23h. Quer o cardápio?' },
  { id: 'confeitaria', label: 'Confeitaria e doces', Icon: Cake, q: 'Oi! Vocês fazem bolo para festa?', a: 'Fazemos sim! Para quantas pessoas e qual a data da festa?', d: 'Para quantas pessoas e qual a data da festa?' },
  { id: 'loja', label: 'Loja e varejo', Icon: Storefront, q: 'Esse tênis tem no 38?', a: 'Tem sim! Quer que eu separe para retirada ou prefere entrega?', d: 'Tem. Retirada ou entrega?' },
  { id: 'servicos', label: 'Serviços', Icon: Wrench, q: 'Vocês fazem orçamento?', a: 'Fazemos, sem custo. Pode me contar o que você precisa?', d: 'Fazemos, sem custo. O que você precisa?' },
  { id: 'outro', label: 'Outro', Icon: DotsThreeOutline, q: 'Oi, queria uma informação.', a: 'Claro, me conta como posso ajudar.', d: 'Como posso ajudar?' },
]

const OBJETIVOS: { id: ObjId; titulo: string; desc: string; Icon: Icon; recurso: string }[] = [
  { id: 'ia', titulo: 'Responder clientes com IA', desc: 'O agente responde dúvidas, preços e pedidos a qualquer hora.', Icon: Sparkle, recurso: 'Recurso: Agentes de IA' },
  { id: 'disparos', titulo: 'Enviar promoções e avisos', desc: 'Mensagens para listas de clientes, na hora ou agendadas.', Icon: PaperPlaneTilt, recurso: 'Recurso: Disparos' },
  { id: 'followup', titulo: 'Recuperar quem parou de responder', desc: 'Lembretes automáticos para orçamentos e conversas paradas.', Icon: ClockClockwise, recurso: 'Recurso: Follow-up' },
  { id: 'agenda', titulo: 'Organizar agendamentos', desc: 'Horários marcados no WhatsApp vão direto para o Google Agenda.', Icon: CalendarDots, recurso: 'Recurso: Agenda' },
]

const PASSOS = ['Seu negócio', 'Objetivos', 'WhatsApp', 'Agente de IA']
const EQUIPES = ['Só eu', '2 a 5', '6 ou mais']
const TONS: Tom[] = ['Amigável', 'Profissional', 'Direto']

function Tag({ accent, children }: { accent: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${accent ? 'border-light-accent-700 bg-light-accent-900 text-light-accent-200' : 'border-light-divider bg-light-neutral-900 text-light-neutral-400'}`}
    >
      {children}
    </span>
  )
}

function Heading({ children, sub }: { children: string; sub: string }) {
  return (
    <div>
      <h1 className="text-[30px] font-medium leading-[1.15] tracking-[-0.02em]">{children}</h1>
      <p className="mt-2 text-sm text-light-neutral-500">{sub}</p>
    </div>
  )
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-[9px]">
      <Logo theme="light" height={40} className="-ml-1" priority />
      {children}
    </div>
  )
}

export function Onboarding({ nome, email }: { nome: string; email: string }) {
  const primeiro = nome.trim().split(/\s+/)[0] || 'você'
  const [view, setView] = useState<'onboarding' | 'pronto'>('onboarding')
  const [step, setStep] = useState(1)
  const [emp, setEmp] = useState<{ nome: string; seg: SegId; equipe: string }>({ nome: '', seg: 'outro', equipe: 'Só eu' })
  const [obj, setObj] = useState<ObjId[]>(['ia', 'agenda'])
  const [wa, setWa] = useState<{ conectarAgora: boolean }>({ conectarAgora: false })
  const [ag, setAg] = useState<{ nome: string; tom: Tom }>({ nome: 'Luna', tom: 'Amigável' })
  const [salvando, setSalvando] = useState(false)
  const router = useRouter()
  const [toast, setToast] = useState<{ titulo: string; texto: string; ok: boolean } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const list = timers.current
    return () => list.forEach(clearTimeout)
  }, [])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms))
  }
  const notify = (titulo: string, texto: string, ok = false) => {
    setToast({ titulo, texto, ok })
    later(() => setToast(null), 3600)
  }

  const seg = SEGS.find((s) => s.id === emp.seg) ?? SEGS[0]
  const empNome = emp.nome.trim() || 'seu negócio'
  const agNome = ag.nome.trim() || 'Agente'
  const resposta = ag.tom === 'Amigável' ? `Oi! ${seg.a}` : ag.tom === 'Profissional' ? `Olá, tudo bem? ${seg.a}` : seg.d

  async function avancar() {
    if (step === 1 && !emp.nome.trim()) return notify('Falta o nome da empresa', 'Ele aparece para os seus clientes')
    if (step === 2 && !obj.length) return notify('Escolha pelo menos um', 'Você pode mudar depois')
    if (step === 4 && !ag.nome.trim()) return notify('Dê um nome ao agente', 'Você pode mudar depois')
    if (step < 4) return setStep(step + 1)
    if (salvando) return
    setSalvando(true)
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ empresa: emp.nome.trim(), segmento: emp.seg, objetivos: obj, agenteNome: ag.nome.trim(), tom: ag.tom }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? 'Tente de novo em instantes.')
      }
      // Quem escolheu "Conectar agora" segue direto para a conexão real; os demais veem a lista de primeiros passos.
      if (wa.conectarAgora) return router.push('/whatsapp')
      setView('pronto')
    } catch (e) {
      notify('Não foi possível salvar', e instanceof Error ? e.message : 'Tente de novo em instantes.')
    } finally {
      setSalvando(false)
    }
  }

  const toastEl = toast && (
    <div className="fixed bottom-[22px] right-[22px] z-[60] animate-pcToast" role="status" aria-live="polite">
      <div className="flex max-w-[380px] items-center gap-[11px] rounded-lg border border-light-accent-700 bg-light-surface px-[15px] py-3 shadow-lg">
        {toast.ok ? <Check size={18} weight="fill" className="text-light-accent-400" /> : <Warning size={18} weight="fill" className="text-light-accent-400" />}
        <div>
          <div className="text-[12.5px] font-medium leading-[1.2]">{toast.titulo}</div>
          <div className="mt-[3px] text-[11.5px] text-light-neutral-500">{toast.texto}</div>
        </div>
      </div>
    </div>
  )

  if (view === 'pronto') {
    const itens: { id: string; titulo: string; desc: string; feito: boolean; Icon: Icon; cta?: string; href?: string }[] = [
      { id: 'conta', titulo: 'Conta criada', desc: email, feito: true, Icon: User },
      { id: 'agente', titulo: 'Criar o agente de IA', desc: `${agNome} · tom ${ag.tom.toLowerCase()}`, feito: true, Icon: Sparkle },
      { id: 'wa', titulo: 'Conectar o WhatsApp', desc: 'Libera as automações', feito: false, Icon: WhatsappLogo, cta: 'Conectar', href: '/whatsapp' },
      { id: 'ensinar', titulo: 'Ensinar respostas ao agente', desc: 'Prazos, entrega e formas de pagamento', feito: false, Icon: ChalkboardTeacher, cta: 'Ensinar', href: '/whatsapp' },
      { id: 'contatos', titulo: 'Importar seus contatos', desc: 'Do celular ou de uma planilha CSV', feito: false, Icon: AddressBook, cta: 'Importar', href: '/contatos' },
    ]
    if (obj.includes('agenda')) itens.push({ id: 'google', titulo: 'Conectar o Google Agenda', desc: 'Para a IA oferecer só horários livres', feito: false, Icon: CalendarDots, cta: 'Conectar', href: '/agenda' })
    const feitos = itens.filter((i) => i.feito).length
    const pct = Math.round((feitos / itens.length) * 100)

    return (
      <div className="flex min-h-screen flex-col items-center px-6 pb-12 pt-7 text-[13.5px] text-light-text" style={{ background: 'radial-gradient(900px 480px at 50% -10%, #dcf3d0, transparent 70%), #f6f7ef' }}>
        <div className="self-stretch">
          <Header />
        </div>
        <div className="mt-10 flex w-full max-w-[620px] animate-pcInPronto flex-col gap-6">
          <div className="flex flex-col items-start gap-3.5">
            <span className="grid h-14 w-14 place-items-center rounded-2xl border border-light-accent-600 bg-light-accent-900 shadow-[0_0_0_6px_color-mix(in_srgb,#2e9a48_14%,transparent)]">
              <Logo variant="symbol" size={32} />
            </span>
            <div>
              <h1 className="text-[32px] font-medium leading-[1.12] tracking-[-0.025em]">Tudo pronto, {primeiro}.</h1>
              <p className="mt-2 text-sm leading-normal text-light-neutral-500">Salvamos as suas respostas. Estes são os próximos passos para o {empNome}.</p>
            </div>
          </div>

          <section aria-label="Primeiros passos" className="overflow-hidden rounded-lg border border-light-divider bg-light-surface">
            <div className="flex items-center gap-3.5 border-b border-light-divider px-[18px] py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium leading-[1.2]">Primeiros passos</h2>
                <div className="mt-[9px] h-1.5 overflow-hidden rounded-full bg-light-neutral-900" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso dos primeiros passos">
                  <div className="h-full rounded-full transition-[width] duration-[400ms]" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #7acc4a, #2e9a48)' }} />
                </div>
              </div>
              <div className="whitespace-nowrap text-[13px] font-medium leading-none text-light-accent-200">{feitos} de {itens.length}</div>
            </div>
            <ul className="m-0 list-none p-0">
              {itens.map((c) => (
                <li key={c.id} className="flex items-center gap-[13px] border-b border-light-divider px-[18px] py-[13px]">
                  <span className="grid h-6 w-6 flex-none place-items-center rounded-full border" style={{ borderColor: c.feito ? '#2e9a48' : '#c9cfb8', background: c.feito ? '#2e9a48' : 'transparent' }}>
                    {c.feito ? <Check size={12} weight="bold" color="#ffffff" aria-hidden="true" /> : <c.Icon size={12} className="text-light-neutral-500" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-medium leading-tight ${c.feito ? 'text-light-neutral-500 line-through' : 'text-light-text'}`}>{c.titulo}</div>
                    <div className="mt-0.5 break-words text-[11.5px] text-light-neutral-500">{c.desc}</div>
                  </div>
                  {!c.feito && c.cta &&
                    (c.href ? (
                      <Link href={c.href} className="pc-btn pc-btn-ghost whitespace-nowrap !px-2.5 !py-[5px] !text-xs !text-light-accent-200">
                        {c.cta}
                      </Link>
                    ) : null)}
                </li>
              ))}
            </ul>
            <div className="flex gap-[7px] px-[18px] py-3 text-[11.5px] text-light-neutral-500">
              <Info size={13} aria-hidden="true" className="mt-px flex-none" />
              Você pode fazer cada passo quando quiser.
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/whatsapp" className="pc-btn pc-btn-primary !border-light-accent-400 !px-5 !py-[11px] !text-light-accent-200">
              <ArrowSquareOut aria-hidden="true" /> Ir para o WhatsApp
            </Link>
            <button type="button" onClick={() => { setView('onboarding'); setStep(1) }} className="rounded-sm px-1.5 text-[12.5px] text-light-neutral-500 hover:text-light-neutral-300">
              Refazer configuração
            </button>
          </div>
        </div>
        {toastEl}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col text-[13.5px] text-light-text" style={{ background: 'radial-gradient(900px 420px at 20% -10%, #dcf3d0, transparent 70%), #f6f7ef' }}>
      <header className="flex flex-none flex-wrap items-center gap-5 px-7 py-[18px]">
        <Header />
        <div className="flex min-w-[260px] flex-1 justify-center">
          <div className="flex w-full max-w-[420px] flex-col gap-[7px]">
            <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className="h-1 rounded-full transition-[background] duration-300" style={{ background: i <= step ? 'linear-gradient(90deg, #7acc4a, #2e9a48)' : '#e2e6d5' }} />
              ))}
            </div>
            <div className="flex justify-between text-[11.5px] text-light-neutral-500">
              <span>Passo {step} de 4</span>
              <span>{PASSOS[step - 1]}</span>
            </div>
          </div>
        </div>
        <Link href="/whatsapp" className="text-[12.5px] text-light-neutral-500 hover:text-light-neutral-300">Pular</Link>
        <form action={sairAction}>
          <button type="submit" className="flex items-center gap-1.5 rounded-sm text-[12.5px] text-light-neutral-500 hover:text-light-neutral-300">
            <SignOut aria-hidden="true" /> Sair
          </button>
        </form>
      </header>

      <main className="flex flex-1 justify-center px-6 pb-10 pt-6">
        <div className="flex w-full max-w-[760px] flex-col gap-7">
          {step === 1 && (
            <div className="flex animate-pcIn flex-col gap-[26px]">
              <div>
                <div className="text-[10.5px] font-medium uppercase leading-none tracking-[.16em] text-light-accent-300">Bem-vinda, {primeiro}</div>
                <h1 className="mt-3 text-[30px] font-medium leading-[1.15] tracking-[-0.02em]">Conte um pouco sobre o seu negócio</h1>
                <p className="mt-2 text-sm text-light-neutral-500">Usamos isso para preparar a IA e as mensagens do seu jeito.</p>
              </div>
              <div className="max-w-[420px]">
                <label htmlFor="emp-nome" className="pc-label">Nome da empresa</label>
                <input id="emp-nome" className="pc-input" value={emp.nome} onChange={(e) => setEmp({ ...emp, nome: e.target.value })} placeholder="Ex.: Barbearia do João" autoComplete="organization" />
              </div>
              <div role="group" aria-labelledby="seg-label">
                <div id="seg-label" className="pc-label">Segmento</div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
                  {SEGS.map((s) => {
                    const on = s.id === emp.seg
                    return (
                      <button key={s.id} type="button" aria-pressed={on} onClick={() => setEmp({ ...emp, seg: s.id })}
                        className="flex items-center gap-2.5 rounded-md border p-3 text-left text-[13px] text-light-text transition-[border-color,background] duration-150 hover:border-light-accent-600"
                        style={{ borderColor: on ? '#2e9a48' : '#e3e7d6', background: on ? '#f0faea' : '#ffffff' }}>
                        <s.Icon size={18} aria-hidden="true" className={on ? 'text-light-accent-300' : 'text-light-neutral-500'} />
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div role="group" aria-labelledby="eq-label" className="max-w-[420px]">
                <div id="eq-label" className="pc-label">Quantas pessoas atendem o WhatsApp?</div>
                <div className="pc-seg">
                  {EQUIPES.map((o) => (
                    <button key={o} type="button" className="pc-seg-opt" aria-pressed={emp.equipe === o} onClick={() => setEmp({ ...emp, equipe: o })}>{o}</button>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-light-neutral-500"><LockSimple size={12} aria-hidden="true" /> O tamanho da equipe ainda não é salvo.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex animate-pcIn flex-col gap-[26px]">
              <Heading sub="Escolha quantos quiser. Eles orientam o agente de IA; você liga cada recurso quando quiser.">O que você quer resolver primeiro?</Heading>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3" role="group" aria-label="Objetivos">
                {OBJETIVOS.map((o) => {
                  const on = obj.includes(o.id)
                  return (
                    <button key={o.id} type="button" role="checkbox" aria-checked={on}
                      onClick={() => setObj(on ? obj.filter((x) => x !== o.id) : [...obj, o.id])}
                      className="flex items-start gap-3.5 rounded-lg border p-[18px] text-left text-light-text transition-[border-color,background,box-shadow] duration-150 hover:border-light-accent-600"
                      style={{ borderColor: on ? '#2e9a48' : '#e3e7d6', background: on ? 'color-mix(in srgb, #2e9a48 8%, #ffffff)' : '#ffffff', boxShadow: on ? '0 6px 20px rgba(46,154,72,.12)' : 'none' }}>
                      <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[11px] border border-light-accent-700" style={{ background: on ? '#dcf3d0' : '#f0faea' }}>
                        <o.Icon size={20} className="text-light-accent-300" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-medium leading-tight">{o.titulo}</span>
                        <span className="mt-[5px] block text-[12.5px] leading-[1.45] text-light-neutral-500 [text-wrap:pretty]">{o.desc}</span>
                        <span className="mt-[9px] block text-[11px] text-light-accent-300">{o.recurso}</span>
                      </span>
                      <span aria-hidden="true" className="grid h-5 w-5 flex-none place-items-center rounded-md border" style={{ borderColor: on ? '#2e9a48' : '#c9cfb8', background: on ? '#2e9a48' : 'transparent' }}>
                        {on && <Check size={12} weight="bold" color="#ffffff" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex animate-pcIn flex-col gap-6">
              <Heading sub="É o que libera as automações. Leva menos de um minuto.">Conecte seu WhatsApp</Heading>
              <div className="flex max-w-[520px] flex-col gap-4 rounded-lg border border-light-divider bg-light-surface p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-full border border-light-accent-600 bg-light-accent-900">
                    <WhatsappLogo size={20} className="text-light-accent-300" aria-hidden="true" />
                  </span>
                  <div className="text-sm font-medium leading-tight">Conexão por QR code</div>
                </div>
                <p className="text-[12.5px] leading-[1.5] text-light-neutral-400 [text-wrap:pretty]">
                  Ao terminar, levamos você à tela do WhatsApp, onde aparece o QR code para escanear em Dispositivos conectados. A conexão é feita lá, com o seu número de verdade.
                </p>
                <div className="flex gap-[9px] rounded-md border border-light-divider bg-light-bg px-[13px] py-[11px] text-xs leading-[1.45] text-light-neutral-400">
                  <Info size={15} className="mt-px flex-none text-light-accent-300" aria-hidden="true" />
                  <span>É uma conexão não oficial: disparos em massa podem bloquear o número. Veja os Termos de uso.</span>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <button type="button" onClick={() => { setWa({ conectarAgora: true }); setStep(4) }} className="pc-btn pc-btn-primary !border-light-accent-400 !text-light-accent-200">
                    <WhatsappLogo aria-hidden="true" /> Conectar agora
                  </button>
                  <button type="button" onClick={() => { setWa({ conectarAgora: false }); setStep(4) }} className="pc-btn pc-btn-secondary">Fazer depois</button>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex animate-pcIn flex-col gap-6">
              <Heading sub="Dê um nome e um jeito de falar. Você ensina o resto depois, quando quiser.">Conheça seu agente de IA</Heading>
              <div className="flex flex-wrap items-start gap-5">
                <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
                  <div>
                    <label htmlFor="ag-nome" className="pc-label">Nome do agente</label>
                    <input id="ag-nome" className="pc-input" value={ag.nome} onChange={(e) => setAg({ ...ag, nome: e.target.value })} placeholder="Ex.: Luna" />
                  </div>
                  <div role="group" aria-labelledby="tom-label">
                    <div id="tom-label" className="pc-label">Tom de voz</div>
                    <div className="pc-seg">
                      {TONS.map((o) => (
                        <button key={o} type="button" className="pc-seg-opt" aria-pressed={ag.tom === o} onClick={() => setAg({ ...ag, tom: o })}>{o}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-[9px] rounded-md border border-light-divider bg-light-surface px-3.5 py-[13px] text-[11.5px] leading-[1.45] text-light-neutral-500">
                    <Info size={14} className="mt-px flex-none text-light-accent-300" aria-hidden="true" />
                    <span>Você liga o agente na tela do WhatsApp, depois de conectar o número.</span>
                  </div>
                </div>
                <div className="min-w-0 flex-[1_1_320px] overflow-hidden rounded-lg border border-light-divider bg-light-surface">
                  <div className="flex items-center gap-2.5 border-b border-light-divider px-3.5 py-3">
                    <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-light-neutral-900 text-[11px] font-medium leading-none text-light-accent-200">CL</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium leading-[1.2]">Cliente</div>
                      <div className="text-[10.5px] text-light-neutral-500">Prévia da conversa</div>
                    </div>
                    <span className="max-w-[40%] truncate"><Tag accent>{empNome}</Tag></span>
                  </div>
                  <div className="flex flex-col gap-2.5 bg-light-bg p-4" aria-live="polite">
                    <div className="max-w-[82%] self-start rounded-[14px_14px_14px_4px] border border-light-divider bg-light-surface px-3 py-[9px] text-[13px] leading-[1.45]">{seg.q}</div>
                    <div key={`${ag.tom}-${seg.id}`} className="max-w-[88%] animate-pcFade self-end rounded-[14px_14px_4px_14px] border border-light-accent-700 bg-light-accent-900 px-3 py-[9px] text-[13px] leading-[1.45]">
                      <div className="mb-1.5 flex items-center gap-[5px] text-[10.5px] font-medium leading-none text-light-accent-300"><Sparkle size={10} weight="fill" aria-hidden="true" />{agNome} · IA</div>
                      {resposta}
                    </div>
                  </div>
                  <div className="flex gap-[7px] border-t border-light-divider px-3.5 py-2.5 text-[11.5px] text-light-neutral-500">
                    <ShieldCheck size={13} className="text-light-accent-300" aria-hidden="true" />O agente só fala sobre o seu negócio.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-light-divider pt-5">
            {step > 1 && (
              <button type="button" onClick={() => setStep(step - 1)} className="pc-btn pc-btn-ghost"><ArrowLeft aria-hidden="true" /> Voltar</button>
            )}
            <div className="flex-1" />
            {step !== 3 && (
            <button type="button" onClick={avancar} disabled={salvando} className="pc-btn pc-btn-primary !border-light-accent-400 !px-[18px] !py-2.5 !text-[13.5px] !text-light-accent-200">
              {step === 4 ? (salvando ? 'Salvando…' : 'Concluir') : 'Continuar'} <ArrowRight aria-hidden="true" />
            </button>
            )}
          </div>
        </div>
      </main>
      {toastEl}
    </div>
  )
}
