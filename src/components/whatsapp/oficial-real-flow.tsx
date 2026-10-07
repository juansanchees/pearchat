'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, Check, CheckCircle, CreditCard, DeviceMobile, MetaLogo, SealCheck, UsersThree, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { maskPhoneInput } from '@/lib/phone'
import type { WhatsAppStatusDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { errMessage, waApi } from './api'
import { loadFacebookSdk, startEmbeddedSignup } from './meta-signup'
import type { EmbeddedSignupHandle, FbSdk } from './meta-signup'
import { BackLink, btnPrimary, btnSecondary, inputCls, kicker, pageShell, Tag } from './ui'

// Conexão oficial REAL (Cloud API da Meta, Cadastro incorporado v4). Sem passos simulados: o QR do Coexistence é lido
// dentro da janela da Meta, não aqui. Passos: 1 explicação -> 2 espera (janela da Meta) -> 3 conversas e pagamento.

type Step = 'intro' | 'espera' | 'hist'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'intro', label: 'Meta' },
  { id: 'espera', label: 'Cadastro' },
  { id: 'hist', label: 'Conversas' },
]

const h2 = 'text-[26px] font-medium leading-[1.15] tracking-[-.02em]'
const POLL_MS = 5_000
const BILLING_URL = 'https://business.facebook.com/billing_hub/payment_settings'

function StepIndicator({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.id === step)
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'future'
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <span
              className={cn(
                'grid h-[22px] w-[22px] place-items-center rounded-pill border text-[11px] font-medium leading-none',
                state === 'done' && 'border-light-accent-500 bg-light-accent-fill text-white',
                state === 'current' && 'border-light-accent-500 bg-light-accent-900 text-light-accent-200',
                state === 'future' && 'border-light-divider bg-transparent text-light-neutral-500',
              )}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={cn('whitespace-nowrap text-[11.5px]', state === 'current' ? 'text-light-text' : 'text-light-neutral-500')}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-[18px] bg-light-divider" />}
          </div>
        )
      })}
    </div>
  )
}

function Spinner() {
  return <span className="inline-block h-[30px] w-[30px] animate-zfSpin rounded-full border-2 border-light-accent-400 border-t-transparent" />
}

export function OficialRealFlow({ onBack }: { onBack: () => void }) {
  const { setWa, toast, connectCfg, locale } = useAppState()
  const [step, setStep] = useState<Step>('intro')
  // Modo efetivo: começa pelo configurado; se o SDK não carregar, cai sozinho para o link hospedado pela Meta.
  const [mode, setMode] = useState<'sdk' | 'hosted'>(connectCfg.signupMode)
  const [fallbackNote, setFallbackNote] = useState(false)
  const [state, setState] = useState<{ id: string; hostedUrl: string } | null>(null)
  const [fb, setFb] = useState<FbSdk | null>(null)
  const [numero, setNumero] = useState('')
  const [working, setWorking] = useState(false) // trocando o código com a Meta / procurando o cadastro
  const [error, setError] = useState<string | null>(null)
  const [dto, setDto] = useState<WhatsAppStatusDTO | null>(null)
  const [hist, setHist] = useState(true)
  const [busy, setBusy] = useState(false)
  const handle = useRef<EmbeddedSignupHandle | null>(null)
  const alive = useRef(true)
  const stateRef = useRef(state)
  stateRef.current = state

  const prepare = useCallback(async (forceMode?: 'hosted') => {
    try {
      const r = await waApi.signupStart(forceMode)
      if (alive.current) setState({ id: r.state, hostedUrl: r.hostedUrl })
    } catch (e) {
      if (alive.current) setError(errMessage(e))
    }
  }, [])

  // Pré-carrega o state (uso único) e o SDK: o clique chama FB.login direto, sem popup bloqueado.
  useEffect(() => {
    alive.current = true
    void prepare()
    return () => {
      alive.current = false
      handle.current?.cancel()
    }
  }, [prepare])

  useEffect(() => {
    if (mode !== 'sdk' || fb) return
    let cancelled = false
    loadFacebookSdk(connectCfg.metaAppId, connectCfg.graphVersion)
      .then((sdk) => !cancelled && setFb(sdk))
      .catch(() => {
        if (cancelled) return
        setMode('hosted')
        setFallbackNote(true)
        // O state do modo SDK não vale no hospedado: pede outro já marcado como hospedado.
        setState(null)
        void prepare('hosted')
      })
    return () => {
      cancelled = true
    }
  }, [mode, fb, connectCfg.metaAppId, connectCfg.graphVersion, prepare])

  const done = (next: WhatsAppStatusDTO) => {
    setDto(next)
    setWorking(false)
    setStep('hist')
  }

  const failWith = (msg: string) => {
    setWorking(false)
    setError(msg)
    setStep('intro')
    setState(null)
    void prepare(mode === 'hosted' ? 'hosted' : undefined) // o state é de uso único: gera outro para a nova tentativa
  }

  const startSdk = () => {
    if (!fb || !state) return
    setError(null)
    handle.current?.cancel()
    const st = state.id
    const h = startEmbeddedSignup(fb, {
      appId: connectCfg.metaAppId,
      configId: connectCfg.metaConfigId,
      graphVersion: connectCfg.graphVersion,
      sessionInfoVersion: connectCfg.sessionInfoVersion,
      featureType: connectCfg.featureType || undefined,
    })
    handle.current = h
    setStep('espera')
    h.promise
      .then(async (res) => {
        if (handle.current !== h || !alive.current) return
        setWorking(true)
        const next = await waApi.embeddedSignup({
          state: st,
          code: res.code,
          wabaId: res.wabaId,
          phoneNumberId: res.phoneNumberId,
          businessId: res.businessId,
          event: res.event,
        })
        if (alive.current) done(next)
      })
      .catch((e: unknown) => {
        if (handle.current !== h || !alive.current) return
        failWith(errMessage(e))
      })
  }

  const checkHosted = useCallback(async () => {
    const st = stateRef.current
    if (!st || numero.replace(/\D/g, '').length < 10) return
    try {
      const r = await waApi.hostedCheck({ state: st.id, numero })
      if (!alive.current) return
      if (r.status === 'connected') done(r.dto)
      else if (r.status === 'ambiguous') setError(r.message)
    } catch (e) {
      if (alive.current) failWith(errMessage(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero])

  const startHosted = () => {
    if (!state) return
    if (numero.replace(/\D/g, '').length < 10) {
      setError('Digite o número do WhatsApp com DDD para continuarmos.')
      return
    }
    setError(null)
    window.open(state.hostedUrl, '_blank', 'noopener,noreferrer')
    setStep('espera')
  }

  // Fluxo hospedado: a Meta avisa por webhook; a tela consulta a cada poucos segundos.
  useEffect(() => {
    if (mode !== 'hosted' || step !== 'espera') return
    const t = window.setInterval(() => void checkHosted(), POLL_MS)
    return () => window.clearInterval(t)
  }, [mode, step, checkHosted])

  const coexistence = !!dto?.coexistence

  const concluir = async () => {
    setBusy(true)
    try {
      const next = await waApi.finish(coexistence ? hist : false)
      setWa(next)
      toast({
        icon: <SealCheck size={18} weight="fill" />,
        title: 'WhatsApp oficial conectado',
        text: coexistence && hist ? 'Importando conversas do seu WhatsApp Business' : (next.numero ?? ''),
      })
    } catch (e) {
      setBusy(false)
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível concluir', text: errMessage(e) })
    }
  }

  const hosted = mode === 'hosted'
  const ready = hosted ? !!state : !!state && !!fb

  return (
    <div className={pageShell}>
      <div className="relative flex w-[min(880px,100%)] animate-zfIn flex-col gap-[26px] rounded-md bg-light-surface px-9 py-8 shadow-md">
        <div className="flex flex-wrap items-center gap-3.5">
          <BackLink onClick={onBack} />
          <div className="flex-1" />
          <StepIndicator step={step} />
        </div>

        {step === 'intro' && (
          <div className="flex flex-wrap items-start gap-9">
            <div className="min-w-0 flex-[1_1_320px]">
              <div className="flex items-center gap-2">
                <span className={kicker}>WhatsApp Business</span>
                <Tag tone="accent" size={10}>Oficial</Tag>
              </div>
              <h1 className={cn(h2, 'mt-3')}>Conecte pela plataforma oficial da Meta</h1>
              <p className="mt-2.5 max-w-[46ch] leading-normal text-light-neutral-400">
                Uma janela da Meta vai abrir para você entrar, escolher o número e, se ele estiver no app WhatsApp Business, ler um QR code no
                celular. O número continua funcionando no celular.
              </p>
              {hosted && (
                <div className="mt-[22px] max-w-[340px]">
                  <label htmlFor="of-numero" className="mb-[5px] block text-[12px] text-light-text/70">
                    Número do WhatsApp que você vai conectar
                  </label>
                  <input
                    id="of-numero"
                    className={inputCls}
                    placeholder="+55 11 90000-0000"
                    value={numero}
                    onChange={(e) => setNumero(maskPhoneInput(e.target.value, locale.ddiPadrao))}
                    inputMode="tel"
                    autoComplete="tel"
                  />
                  <p className="mt-1.5 text-[11.5px] text-light-neutral-500">Usamos o número para confirmar que o cadastro feito na Meta é o seu.</p>
                </div>
              )}
              {fallbackNote && (
                <p className="mt-3 max-w-[46ch] text-[12px] text-light-neutral-500">
                  Não conseguimos carregar o login da Meta neste navegador (pode ser um bloqueador). Vamos abrir a página da Meta em outra aba.
                </p>
              )}
              {error && (
                <p role="alert" className="mt-3 max-w-[46ch] text-[12.5px] text-amber-text">
                  {error}
                </p>
              )}
              <button type="button" className={cn(btnPrimary, 'mt-5')} onClick={hosted ? startHosted : startSdk} disabled={!ready}>
                <MetaLogo size={16} />
                Continuar com a Meta
              </button>
            </div>
            <div className="flex min-w-[260px] flex-[0_1_300px] flex-col gap-3 rounded-lg border border-light-divider bg-light-bg p-[18px]">
              <div className="text-[13px] font-medium leading-tight">Antes de começar</div>
              {[
                { icon: <DeviceMobile size={14} />, text: 'Se o número já usa o app WhatsApp Business, deixe o celular por perto: a Meta mostra um QR code para ler lá.' },
                { icon: <MetaLogo size={14} />, text: 'Você entra com sua conta do Facebook que administra o negócio na Meta.' },
                { icon: <UsersThree size={14} />, text: 'Grupos continuam só no celular. Conversas individuais aparecem aqui.' },
              ].map((it) => (
                <div key={it.text} className="flex gap-[9px] text-[12px] leading-[1.45] text-light-neutral-400">
                  <span className="mt-px flex-none text-light-accent-300">{it.icon}</span>
                  {it.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'espera' && (
          <div className="flex flex-wrap items-center gap-10">
            <div className="min-w-0 flex-[1_1_320px]">
              <h1 className={h2}>{working ? 'Confirmando com a Meta…' : 'Aguardando você concluir na janela da Meta…'}</h1>
              <p className="mt-2.5 max-w-[46ch] leading-normal text-light-neutral-400">
                {hosted
                  ? 'Termine o cadastro na aba da Meta. Quando acabar, esta tela avança sozinha.'
                  : 'Siga as instruções na janela da Meta. Se ela não abriu, desbloqueie pop-ups para este site e tente de novo.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {hosted ? (
                  <>
                    <button type="button" className={btnPrimary} onClick={() => void checkHosted()}>
                      <Check size={16} />
                      Já concluí
                    </button>
                    <button type="button" className={btnSecondary} onClick={() => state && window.open(state.hostedUrl, '_blank', 'noopener,noreferrer')}>
                      <ArrowSquareOut size={16} />
                      Abrir a Meta de novo
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => {
                      handle.current?.cancel()
                      failWith('Conexão cancelada.')
                    }}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
            <div className="flex h-[200px] w-[280px] flex-none flex-col items-center justify-center gap-3 rounded-lg border border-light-divider bg-light-surface p-6 text-center">
              <Spinner />
              <span className="text-[13px] font-medium leading-snug">{working ? 'Quase lá' : 'Siga as instruções na janela da Meta'}</span>
            </div>
          </div>
        )}

        {step === 'hist' && (
          <div className="flex flex-wrap items-start gap-9">
            <div className="min-w-0 flex-[1_1_320px]">
              <div className="flex items-center gap-2 text-[12px] text-light-accent-300">
                <CheckCircle size={14} weight="fill" />
                {dto?.numero ? `${dto.numero} conectado` : 'Número conectado'}
              </div>
              {coexistence ? (
                <>
                  <h1 className={cn(h2, 'mt-3')}>Trazer suas conversas?</h1>
                  <p className="mt-2.5 max-w-[46ch] leading-normal text-light-neutral-400">
                    Podemos importar os contatos e as conversas individuais que a Meta liberar (até 6 meses). Grupos não são importados.
                  </p>
                  <div role="radiogroup" aria-label="Importar conversas" className="mt-5 flex max-w-[420px] flex-col gap-2">
                    {[
                      { value: true, title: 'Importar conversas e contatos', desc: 'Histórico das conversas individuais' },
                      { value: false, title: 'Começar do zero', desc: 'Só as novas conversas aparecem aqui' },
                    ].map((o) => {
                      const on = hist === o.value
                      return (
                        <button
                          key={o.title}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setHist(o.value)}
                          className={cn(
                            'flex items-start gap-3 rounded-md border px-3.5 py-3 text-left',
                            on ? 'border-light-accent-600 bg-light-accent-900' : 'border-light-divider bg-transparent',
                          )}
                        >
                          <span className={cn('mt-px grid h-4 w-4 flex-none place-items-center rounded-pill border', on ? 'border-light-accent-400' : 'border-light-neutral-700')}>
                            {on && <span className="h-2 w-2 rounded-pill bg-light-accent-400" />}
                          </span>
                          <span>
                            <span className="block text-[13px] font-medium leading-tight">{o.title}</span>
                            <span className="mt-0.5 block text-[11.5px] text-light-neutral-500">{o.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <>
                  <h1 className={cn(h2, 'mt-3')}>Tudo certo com a Meta</h1>
                  <p className="mt-2.5 max-w-[46ch] leading-normal text-light-neutral-400">
                    Este número agora responde pela plataforma oficial. As novas conversas aparecem aqui assim que os clientes escreverem.
                  </p>
                </>
              )}
              <button type="button" className={cn(btnPrimary, 'mt-[18px]')} onClick={() => void concluir()} disabled={busy}>
                <Check size={16} />
                Concluir conexão
              </button>
            </div>
            <div className="flex min-w-[260px] flex-[0_1_300px] flex-col gap-2.5 rounded-lg border border-amber-border bg-amber-bg p-[18px]">
              <div className="flex items-center gap-[7px] text-[13px] font-medium leading-tight text-amber-text">
                <CreditCard size={16} />
                Cadastre um pagamento na Meta
              </div>
              <p className="text-[12px] leading-normal text-amber-text">
                Cada número tem 1.000 respostas grátis por mês. Sem forma de pagamento no Meta Business, as respostas param quando o limite acaba.
              </p>
              <a
                href={BILLING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 self-start text-[12px] text-amber-text underline"
              >
                Abrir Meta Business
                <ArrowSquareOut size={12} />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
