'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowClockwise, CalendarCheck, CalendarPlus, Check, CheckCircle, Clock, WarningCircle, WhatsappLogo } from '@phosphor-icons/react'
import { Logo } from '@/components/brand/logo'
import { cn } from '@/lib/utils'

// Página pública de agendamento (cliente final, sem login). Um fluxo em uma página:
// serviço -> dia -> horário -> dados -> confirmação. Rotas: /api/public/booking/[slug]/**.

type Servico = { id: string; nome: string; duracaoMin: number }
type Info = { negocio: string; mensagem: string | null; servicos: Servico[]; diasAFrente: number; hoje: string; token: string }
type Dia = { date: string; livres: number }
type Confirmado = {
  negocio: string
  servico: string
  duracaoMin: number
  inicio: string
  data: string
  hora: string
  icsUrl: string
  whatsappUrl: string | null
}

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const parts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m: m - 1, d, dow: new Date(`${date}T12:00:00Z`).getUTCDay() }
}
const diaLongo = (date: string) => {
  const p = parts(date)
  return `${DIAS_LONGOS[p.dow]}, ${p.d} de ${MESES_LONGOS[p.m]}`
}

export function durLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/** Máscara brasileira: (11) 98765-4321. Aceita colar com +55. */
export function maskPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function phoneError(masked: string): string | null {
  const d = masked.replace(/\D/g, '')
  if (d.length < 10) return 'Informe o WhatsApp com DDD.'
  if (d.length === 11 && d[2] !== '9') return 'Celular com 11 dígitos começa com 9 depois do DDD.'
  if (/^(\d)\1+$/.test(d)) return 'Esse número não parece válido.'
  return null
}

async function call<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = (await res.json().catch(() => null)) as T | null
  return { status: res.status, body }
}

const sectionCls = 'flex flex-col gap-3 rounded-lg border border-solid border-light-divider bg-light-surface p-4 shadow-md min-[560px]:p-5'

function StepTitle({ n, children, done }: { n: number; children: ReactNode; done?: boolean }) {
  return (
    <h2 className="m-0 flex items-center gap-2.5 text-[15px] font-medium leading-[1.2]">
      <span
        aria-hidden="true"
        className={cn(
          'grid h-[22px] w-[22px] flex-none place-items-center rounded-pill border text-[11px] font-medium leading-none',
          done ? 'border-light-accent-600 bg-light-accent-800 text-light-accent-200' : 'border-light-divider text-light-neutral-500',
        )}
      >
        {done ? <Check size={11} weight="bold" /> : n}
      </span>
      {children}
    </h2>
  )
}

const pillBase =
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-pill border border-solid text-[13px] transition-colors disabled:cursor-not-allowed'
const pillOn = 'border-light-accent-600 bg-light-accent-900 text-light-accent-200'
const pillOff = 'border-light-divider bg-light-surface text-light-text hover:border-light-neutral-700'

export function BookingFlow({ slug, negocio, logoSrc = null }: { slug: string; negocio: string; logoSrc?: string | null }) {
  const base = `/api/public/booking/${encodeURIComponent(slug)}`
  const [info, setInfo] = useState<Info | null>(null)
  const [loadErr, setLoadErr] = useState<'rede' | 'indisponivel' | null>(null)
  const [servico, setServico] = useState<Servico | null>(null)
  const [dias, setDias] = useState<Dia[] | null>(null)
  const [diasErr, setDiasErr] = useState(false)
  const [dia, setDia] = useState<string | null>(null)
  const [horarios, setHorarios] = useState<string[] | null>(null)
  const [horErr, setHorErr] = useState(false)
  const [hora, setHora] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [tel, setTel] = useState('')
  const [obs, setObs] = useState('')
  const [aceite, setAceite] = useState(false)
  const [site, setSite] = useState('')
  const [tocou, setTocou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ok, setOk] = useState<Confirmado | null>(null)
  const ids = { nome: useId(), tel: useId(), obs: useId(), aceite: useId() }
  const horariosRef = useRef<HTMLElement>(null)
  const dadosRef = useRef<HTMLElement>(null)
  const diaRef = useRef<HTMLElement>(null)
  const seq = useRef(0)

  const carregarInfo = useCallback(async () => {
    setLoadErr(null)
    try {
      const r = await call<Info>(base)
      if (r.status === 404) setLoadErr('indisponivel')
      else if (r.status === 200 && r.body) setInfo(r.body)
      else setLoadErr('rede')
    } catch {
      setLoadErr('rede')
    }
  }, [base])

  useEffect(() => {
    void carregarInfo()
  }, [carregarInfo])

  // O token do formulário vale 30 min: renova em segundo plano para quem demora para preencher.
  useEffect(() => {
    const t = window.setInterval(() => {
      void call<Info>(base).then((r) => {
        if (r.status === 200 && r.body) setInfo((cur) => (cur ? { ...cur, token: r.body!.token } : r.body))
      })
    }, 20 * 60_000)
    return () => window.clearInterval(t)
  }, [base])

  const rolarPara = (ref: React.RefObject<HTMLElement>) => {
    window.setTimeout(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
    }, 60)
  }

  const escolherServico = (s: Servico) => {
    if (servico?.id === s.id) return
    setServico(s)
    setDia(null)
    setHora(null)
    setHorarios(null)
    setDias(null)
    setDiasErr(false)
    setAviso(null)
    const id = ++seq.current
    void call<{ dias: Dia[] }>(`${base}/free?serviceTypeId=${encodeURIComponent(s.id)}`)
      .then((r) => {
        if (id !== seq.current) return
        if (r.status === 200 && r.body) setDias(r.body.dias)
        else setDiasErr(true)
      })
      .catch(() => id === seq.current && setDiasErr(true))
    rolarPara(diaRef)
  }

  const carregarHorarios = useCallback(
    async (s: Servico, d: string) => {
      const id = ++seq.current
      setHorarios(null)
      setHorErr(false)
      try {
        const r = await call<{ horarios: string[] }>(`${base}/free?serviceTypeId=${encodeURIComponent(s.id)}&date=${d}`)
        if (id !== seq.current) return
        if (r.status === 200 && r.body) setHorarios(r.body.horarios)
        else setHorErr(true)
      } catch {
        if (id === seq.current) setHorErr(true)
      }
    },
    [base],
  )

  const escolherDia = (d: string) => {
    if (!servico) return
    setDia(d)
    setHora(null)
    setAviso(null)
    void carregarHorarios(servico, d)
    rolarPara(horariosRef)
  }

  const escolherHora = (h: string) => {
    setHora(h)
    setAviso(null)
    rolarPara(dadosRef)
  }

  const nomeErr = nome.trim().length < 2 ? 'Informe seu nome.' : null
  const telErr = phoneError(tel)
  const aceiteErr = aceite ? null : 'Para agendar, aceite a Política de Privacidade.'
  const podeEnviar = !!(servico && dia && hora && !nomeErr && !telErr && aceite)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTocou(true)
    setAviso(null)
    if (!servico || !dia || !hora || !info || nomeErr || telErr || aceiteErr || enviando) return
    setEnviando(true)
    try {
      const r = await call<{ agendamento?: Confirmado; message?: string; error?: string }>(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: info.token,
          website: site,
          serviceTypeId: servico.id,
          date: dia,
          hora,
          nome: nome.trim(),
          telefone: tel.replace(/\D/g, ''),
          observacao: obs.trim() || null,
          aceite: true,
        }),
      })
      if (r.status === 201 && r.body?.agendamento) {
        setOk(r.body.agendamento)
        window.scrollTo({ top: 0 })
      } else if (r.status === 409) {
        setAviso(r.body?.message ?? 'Esse horário acabou de ser reservado, escolha outro.')
        setHora(null)
        void carregarHorarios(servico, dia)
        void escolherServicoRefresh(servico)
        rolarPara(horariosRef)
      } else if (r.status === 404) {
        setLoadErr('indisponivel')
      } else {
        setAviso(r.body?.message ?? 'Não foi possível concluir o agendamento. Tente novamente em instantes.')
      }
    } catch {
      setAviso('Sem conexão. Confira sua internet e tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  // Atualiza o resumo dos dias (um dia pode ter ficado cheio).
  const escolherServicoRefresh = async (s: Servico) => {
    try {
      const r = await call<{ dias: Dia[] }>(`${base}/free?serviceTypeId=${encodeURIComponent(s.id)}`)
      if (r.status === 200 && r.body) setDias(r.body.dias)
    } catch {
      /* mantém o que já está na tela */
    }
  }

  const recomecar = () => {
    setOk(null)
    setServico(null)
    setDia(null)
    setHora(null)
    setDias(null)
    setHorarios(null)
    setObs('')
    setAceite(false)
    setTocou(false)
    void carregarInfo()
  }

  const nomeNegocio = info?.negocio ?? negocio
  const semDiaLivre = useMemo(() => dias !== null && dias.every((d) => d.livres === 0), [dias])

  return (
    <div className="flex min-h-screen flex-col bg-light-bg text-[13.5px] text-light-text [color-scheme:light]">
      <header
        className="px-5 pb-12 pt-8 text-dark-text min-[560px]:pb-14 min-[560px]:pt-10"
        style={{
          background:
            'radial-gradient(700px 320px at 10% 0%, #173322, transparent 70%), radial-gradient(600px 320px at 100% 100%, #12251a, transparent 70%), #14170f',
        }}
      >
        <div className="mx-auto w-full max-w-[560px]">
          {logoSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt={`Logo de ${nomeNegocio}`} width={56} height={56} className="mb-4 h-14 w-14 rounded-pill border border-dark-accent-700 object-cover" />
          )}
          <p className="m-0 text-[11px] font-medium uppercase leading-none tracking-[0.12em] text-dark-accent-300">Agendamento online</p>
          <h1 className="mb-0 mt-3 text-balance text-[28px] font-medium leading-[1.15] tracking-[-0.02em] min-[560px]:text-[34px]">{nomeNegocio}</h1>
          {info?.mensagem && <p className="mb-0 mt-3 max-w-[48ch] text-[14px] leading-[1.55] text-dark-neutral-300 [text-wrap:pretty]">{info.mensagem}</p>}
        </div>
      </header>

      <main className="relative z-[1] mx-auto -mt-7 flex w-full max-w-[560px] flex-1 flex-col gap-3.5 px-4 pb-8">
        {loadErr === 'indisponivel' ? (
          <div className={cn(sectionCls, 'items-center py-8 text-center')} role="alert">
            <WarningCircle size={26} className="text-light-neutral-500" aria-hidden="true" />
            <div className="text-[15px] font-medium">Este link não está disponível</div>
            <p className="m-0 text-[13px] text-light-neutral-500">Fale diretamente com o negócio para marcar seu horário.</p>
          </div>
        ) : loadErr === 'rede' ? (
          <div className={cn(sectionCls, 'items-center py-8 text-center')} role="alert">
            <WarningCircle size={26} className="text-light-neutral-500" aria-hidden="true" />
            <div className="text-[15px] font-medium">Não foi possível carregar</div>
            <p className="m-0 text-[13px] text-light-neutral-500">Confira sua internet e tente de novo.</p>
            <button type="button" className="pc-btn pc-btn-secondary" onClick={() => void carregarInfo()}>
              <ArrowClockwise size={14} aria-hidden="true" /> Tentar de novo
            </button>
          </div>
        ) : !info ? (
          <div className={cn(sectionCls, 'animate-pulse')} role="status" aria-label="Carregando">
            <div className="h-[14px] w-[140px] rounded-pill bg-light-neutral-900" />
            <div className="h-[52px] rounded-md bg-light-neutral-900" />
            <div className="h-[52px] rounded-md bg-light-neutral-900" />
          </div>
        ) : ok ? (
          <Confirmacao ok={ok} onNovo={recomecar} />
        ) : info.servicos.length === 0 ? (
          <div className={cn(sectionCls, 'items-center py-8 text-center')}>
            <CalendarCheck size={26} className="text-light-neutral-500" aria-hidden="true" />
            <div className="text-[15px] font-medium">Nenhum serviço disponível agora</div>
            <p className="m-0 text-[13px] text-light-neutral-500">Este negócio ainda não liberou serviços para agendamento online. Fale diretamente com ele.</p>
          </div>
        ) : (
          <form onSubmit={(e) => void enviar(e)} noValidate className="flex flex-col gap-3.5">
            <section className={sectionCls} aria-labelledby="passo-servico">
              <StepTitle n={1} done={!!servico}>
                <span id="passo-servico">Escolha o serviço</span>
              </StepTitle>
              <div role="radiogroup" aria-labelledby="passo-servico" className="flex flex-col gap-2">
                {info.servicos.map((s) => {
                  const on = servico?.id === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => escolherServico(s)}
                      className={cn(
                        'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-md border border-solid px-[14px] py-3 text-left',
                        on ? 'border-light-accent-600 bg-light-accent-900' : 'border-light-divider bg-transparent hover:border-light-neutral-700',
                      )}
                    >
                      <span className={cn('grid h-4 w-4 flex-none place-items-center rounded-pill border', on ? 'border-light-accent-400' : 'border-light-neutral-700')}>
                        <span className={cn('h-2 w-2 rounded-pill', on ? 'bg-light-accent-400' : 'bg-transparent')} />
                      </span>
                      <span className="min-w-0 flex-1 text-[14px] font-medium leading-[1.25]">{s.nome}</span>
                      <span className="flex flex-none items-center gap-1 text-[12px] text-light-neutral-500">
                        <Clock size={12} aria-hidden="true" />
                        {durLabel(s.duracaoMin)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            {servico && (
              <section ref={diaRef} className={sectionCls} aria-labelledby="passo-dia">
                <StepTitle n={2} done={!!dia}>
                  <span id="passo-dia">Escolha o dia</span>
                </StepTitle>
                {diasErr ? (
                  <Falha onRetry={() => escolherServico({ ...servico })} texto="Não foi possível carregar os dias." />
                ) : dias === null ? (
                  <div className="flex animate-pulse gap-2" role="status" aria-label="Carregando dias">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-[64px] w-[54px] flex-none rounded-md bg-light-neutral-900" />
                    ))}
                  </div>
                ) : semDiaLivre ? (
                  <p className="m-0 rounded-md border border-dashed border-light-divider p-4 text-center text-[13px] text-light-neutral-500">
                    Não há horários livres nos próximos {info.diasAFrente} dias para este serviço. Fale diretamente com o negócio.
                  </p>
                ) : (
                  <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2" role="group" aria-labelledby="passo-dia" tabIndex={0}>
                    {dias.map((d) => {
                      const p = parts(d.date)
                      const on = dia === d.date
                      const vazio = d.livres === 0
                      const primeiroDoMes = p.d === 1 || d.date === dias[0].date
                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={vazio}
                          aria-pressed={on}
                          aria-label={`${diaLongo(d.date)}${vazio ? ', sem horários' : ''}`}
                          onClick={() => escolherDia(d.date)}
                          className={cn(
                            'flex h-[68px] w-[56px] flex-none snap-start cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-solid',
                            on ? pillOn : pillOff,
                            vazio && 'cursor-not-allowed opacity-40 hover:border-light-divider',
                          )}
                        >
                          <span className="text-[10.5px] uppercase leading-none text-light-neutral-500">{d.date === info.hoje ? 'hoje' : DIAS_CURTOS[p.dow]}</span>
                          <span className="text-[18px] font-medium leading-none">{p.d}</span>
                          <span className="text-[10px] leading-none text-light-neutral-500">{primeiroDoMes ? MESES_CURTOS[p.m] : ' '}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {servico && dia && (
              <section ref={horariosRef} className={sectionCls} aria-labelledby="passo-hora">
                <StepTitle n={3} done={!!hora}>
                  <span id="passo-hora">Escolha o horário</span>
                </StepTitle>
                <div className="text-[12px] text-light-neutral-500">{diaLongo(dia)}</div>
                {aviso && !hora && (
                  <div role="alert" className="flex items-start gap-2 rounded-md border border-solid border-[#c9806b] bg-[#fbf1ee] px-3 py-2 text-[12.5px] text-[#7d3524]">
                    <WarningCircle size={15} className="mt-px flex-none" aria-hidden="true" />
                    {aviso}
                  </div>
                )}
                {horErr ? (
                  <Falha onRetry={() => void carregarHorarios(servico, dia)} texto="Não foi possível carregar os horários." />
                ) : horarios === null ? (
                  <div className="grid animate-pulse grid-cols-4 gap-2" role="status" aria-label="Carregando horários">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <div key={i} className="h-[42px] rounded-pill bg-light-neutral-900" />
                    ))}
                  </div>
                ) : horarios.length === 0 ? (
                  <p className="m-0 rounded-md border border-dashed border-light-divider p-4 text-center text-[13px] text-light-neutral-500">
                    Não há mais horários livres neste dia. Escolha outro dia.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 min-[480px]:grid-cols-5" role="group" aria-labelledby="passo-hora">
                    {horarios.map((h) => (
                      <button
                        key={h}
                        type="button"
                        aria-pressed={hora === h}
                        onClick={() => escolherHora(h)}
                        className={cn(pillBase, 'min-h-[42px] px-2', hora === h ? pillOn : pillOff)}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {servico && dia && hora && (
              <section ref={dadosRef} className={sectionCls} aria-labelledby="passo-dados">
                <StepTitle n={4} done={podeEnviar}>
                  <span id="passo-dados">Seus dados</span>
                </StepTitle>
                <div>
                  <label htmlFor={ids.nome} className="pc-label">
                    Seu nome
                  </label>
                  <input
                    id={ids.nome}
                    className="pc-input"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    aria-invalid={tocou && !!nomeErr}
                    aria-describedby={tocou && nomeErr ? `${ids.nome}-erro` : undefined}
                    placeholder="Como podemos te chamar?"
                  />
                  {tocou && nomeErr && <Erro id={`${ids.nome}-erro`}>{nomeErr}</Erro>}
                </div>
                <div>
                  <label htmlFor={ids.tel} className="pc-label">
                    Seu WhatsApp
                  </label>
                  <input
                    id={ids.tel}
                    className="pc-input"
                    value={tel}
                    onChange={(e) => setTel(maskPhone(e.target.value))}
                    inputMode="tel"
                    autoComplete="tel-national"
                    maxLength={16}
                    aria-invalid={tocou && !!telErr}
                    aria-describedby={tocou && telErr ? `${ids.tel}-erro` : undefined}
                    placeholder="(11) 98765-4321"
                  />
                  {tocou && telErr && <Erro id={`${ids.tel}-erro`}>{telErr}</Erro>}
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor={ids.obs} className="pc-label">
                      Observação (opcional)
                    </label>
                    <span className="text-[11px] text-light-neutral-500" aria-hidden="true">
                      {obs.length}/200
                    </span>
                  </div>
                  <textarea
                    id={ids.obs}
                    className="pc-input !min-h-[72px]"
                    value={obs}
                    onChange={(e) => setObs(e.target.value.slice(0, 200))}
                    maxLength={200}
                    rows={3}
                    placeholder="Algo que o negócio deva saber?"
                  />
                </div>

                {/* Isca contra robôs: fora da tela e fora da ordem de tabulação. Pessoas nunca preenchem. */}
                <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0">
                  <label htmlFor="booking-website">Site</label>
                  <input id="booking-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} />
                </div>

                <div>
                  <label htmlFor={ids.aceite} className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-[1.45] text-light-neutral-400">
                    <input
                      id={ids.aceite}
                      type="checkbox"
                      checked={aceite}
                      onChange={(e) => setAceite(e.target.checked)}
                      aria-invalid={tocou && !aceite}
                      aria-describedby={tocou && !aceite ? `${ids.aceite}-erro` : undefined}
                      className="mt-[2px] h-[18px] w-[18px] flex-none cursor-pointer accent-[#2e9a48]"
                    />
                    <span>
                      Ao agendar você concorda com a{' '}
                      <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-medium text-light-accent-200 underline">
                        Política de Privacidade
                      </a>
                      .
                    </span>
                  </label>
                  {tocou && !aceite && <Erro id={`${ids.aceite}-erro`}>{aceiteErr ?? ''}</Erro>}
                </div>

                <div className="rounded-md border border-solid border-light-accent-700 bg-light-accent-900 px-3 py-2.5 text-[12.5px] text-light-accent-200">
                  <b className="font-medium">{servico.nome}</b> · {diaLongo(dia)} às {hora}
                </div>

                {aviso && hora && (
                  <div role="alert" className="flex items-start gap-2 rounded-md border border-solid border-[#c9806b] bg-[#fbf1ee] px-3 py-2 text-[12.5px] text-[#7d3524]">
                    <WarningCircle size={15} className="mt-px flex-none" aria-hidden="true" />
                    {aviso}
                  </div>
                )}

                <button type="submit" disabled={enviando} className="pc-btn pc-btn-primary min-h-[44px] w-full text-[14px]">
                  {enviando ? 'Agendando…' : 'Confirmar agendamento'}
                </button>
              </section>
            )}
          </form>
        )}
      </main>

      <footer className="flex flex-col items-center gap-1.5 px-4 pb-7 pt-2 text-[11.5px] text-light-neutral-500">
        <span>Agendamento por</span>
        <Logo height={22} />
      </footer>
    </div>
  )
}

function Erro({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="m-0 mt-[5px] text-[11.5px] text-[#a0452f]">
      {children}
    </p>
  )
}

function Falha({ texto, onRetry }: { texto: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-md border border-dashed border-light-divider p-4 text-center">
      <div className="text-[13px] text-light-neutral-400">{texto}</div>
      <button type="button" className="pc-btn pc-btn-secondary text-[12px]" onClick={onRetry}>
        <ArrowClockwise size={13} aria-hidden="true" /> Tentar de novo
      </button>
    </div>
  )
}

function Confirmacao({ ok, onNovo }: { ok: Confirmado; onNovo: () => void }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titulo.current?.focus()
  }, [])
  const linhas = [
    { k: 'Serviço', v: ok.servico },
    { k: 'Dia', v: diaLongo(ok.data) },
    { k: 'Horário', v: `${ok.hora} · ${durLabel(ok.duracaoMin)}` },
    { k: 'Local', v: ok.negocio },
  ]
  return (
    <section className={cn(sectionCls, 'items-stretch gap-4')} aria-labelledby="confirmado">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-solid border-light-accent-700 bg-light-accent-900 text-light-accent-300">
          <CheckCircle size={26} weight="fill" aria-hidden="true" />
        </span>
        <h2 id="confirmado" ref={titulo} tabIndex={-1} className="m-0 text-[20px] font-medium leading-[1.2] outline-none">
          Agendamento confirmado
        </h2>
        <p className="m-0 text-[13px] text-light-neutral-500">Tudo certo! Guarde as informações abaixo.</p>
      </div>
      <dl className="m-0 overflow-hidden rounded-md border border-solid border-light-divider">
        {linhas.map((l, i) => (
          <div key={l.k} className={cn('flex items-baseline justify-between gap-4 px-[14px] py-[10px] text-[13px]', i > 0 && 'border-0 border-t border-solid border-light-divider')}>
            <dt className="flex-none text-light-neutral-500">{l.k}</dt>
            <dd className="m-0 min-w-0 text-right font-medium">{l.v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        <a href={ok.icsUrl} download="agendamento.ics" className="pc-btn pc-btn-primary min-h-[44px] w-full no-underline">
          <CalendarPlus size={16} aria-hidden="true" /> Adicionar à minha agenda
        </a>
        {ok.whatsappUrl && (
          <a href={ok.whatsappUrl} target="_blank" rel="noopener noreferrer" className="pc-btn pc-btn-secondary min-h-[44px] w-full no-underline">
            <WhatsappLogo size={16} aria-hidden="true" /> Falar no WhatsApp
          </a>
        )}
        <button type="button" onClick={onNovo} className="pc-btn pc-btn-ghost w-full text-[12.5px]">
          Fazer outro agendamento
        </button>
      </div>
    </section>
  )
}
