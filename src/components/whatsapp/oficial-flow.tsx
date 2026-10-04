'use client'
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle,
  CreditCard,
  DeviceMobile,
  DeviceMobileCamera,
  MetaLogo,
  SealCheck,
  UsersThree,
  Warning,
} from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { cn } from '@/lib/utils'
import { errMessage, waApi } from './api'
import { startEmbeddedSignup } from './meta-signup'
import type { EmbeddedSignupHandle } from './meta-signup'
import { BackLink, btnPrimary, btnSecondary, inputCls, kicker, NumberedSteps, pageShell, QrBox, QrStatusLine, Tag } from './ui'
import { useLater } from './use-later'

type Step = 'numero' | 'qr' | 'hist'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'numero', label: 'Número' },
  { id: 'qr', label: 'QR no app' },
  { id: 'hist', label: 'Conversas' },
]


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
            <span className={cn('whitespace-nowrap text-[11.5px]', state === 'current' ? 'text-light-text' : 'text-light-neutral-500')}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-[18px] bg-light-divider" />}
          </div>
        )
      })}
    </div>
  )
}

// Mostra o número digitado no formato +55 11 98765-4321 quando dá para reconhecer.
function prettyPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  const m = /^(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : raw
}

const h2 = 'text-[26px] font-medium leading-[1.15] tracking-[-.02em]'

export function OficialFlow({ onBack }: { onBack: () => void }) {
  const { setWa, toast, connectCfg } = useAppState()
  // A simulação (QR desenhado, "Simular leitura") só existe no modo demo; o resto exige a Meta configurada.
  const META_APP_ID = connectCfg.metaAppId
  const META_CONFIG_ID = connectCfg.metaConfigId
  const SIMULATED = connectCfg.demo
  const later = useLater()
  const [step, setStep] = useState<Step>('numero')
  const [numero, setNumero] = useState('+55 11 98765-4321')
  const [hist, setHist] = useState(true)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const signup = useRef<EmbeddedSignupHandle | null>(null)

  // Ao desmontar (inclui "Trocar tipo de conexão") cancela o listener do popup da Meta.
  useEffect(() => () => signup.current?.cancel(), [])

  const openMeta = () => {
    if (!META_APP_ID || !META_CONFIG_ID) {
      setMetaError('NEXT_PUBLIC_META_APP_ID e NEXT_PUBLIC_META_CONFIG_ID não estão configurados.')
      return
    }
    setMetaError(null)
    signup.current?.cancel()
    const handle = startEmbeddedSignup(META_APP_ID, META_CONFIG_ID)
    signup.current = handle
    setReading(false)
    handle.promise
      .then(async (result) => {
        if (signup.current !== handle) return
        setReading(true)
        await waApi.embeddedSignup(result)
        setReading(false)
        setStep('hist')
      })
      .catch((e: unknown) => {
        if (signup.current !== handle) return
        setReading(false)
        setMetaError(errMessage(e))
      })
  }

  const continuar = async () => {
    if (numero.replace(/\D/g, '').length < 10) {
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Número incompleto', text: 'Digite o número com DDD' })
      return
    }
    setBusy(true)
    try {
      await waApi.connect('oficial', numero)
    } catch (e) {
      setBusy(false)
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível conectar', text: errMessage(e) })
      return
    }
    setBusy(false)
    setStep('qr')
    toast({ icon: <DeviceMobile size={18} weight="fill" />, title: 'Mensagem enviada', text: 'Abra o WhatsApp Business no celular' })
    if (!SIMULATED) openMeta()
  }

  const lerQr = () => {
    if (reading) return
    setReading(true)
    later(() => {
      setReading(false)
      setStep('hist')
    }, 1500)
  }

  const concluir = async () => {
    setBusy(true)
    try {
      // Fluxo simulado: a "leitura" só vira conexão real aqui, para a tela de conversas não abrir antes do passo 3.
      if (SIMULATED) await waApi.mockScan()
      const dto = await waApi.finish(hist)
      setWa(dto)
      toast({
        icon: <SealCheck size={18} weight="fill" />,
        title: 'WhatsApp oficial conectado',
        text: hist ? 'Importando conversas dos últimos 6 meses' : prettyPhone(numero),
      })
    } catch (e) {
      setBusy(false)
      toast({ icon: <Warning size={18} weight="fill" />, title: 'Não foi possível concluir', text: errMessage(e) })
    }
  }

  return (
    <div className={pageShell}>
      <div className="relative flex w-[min(880px,100%)] animate-zfIn flex-col gap-[26px] rounded-md bg-light-surface px-9 py-8 shadow-md">
        <div className="flex flex-wrap items-center gap-3.5">
          <BackLink onClick={onBack} />
          <div className="flex-1" />
          <StepIndicator step={step} />
        </div>

        {step === 'numero' && (
          <div className="flex flex-wrap items-start gap-9">
            <div className="min-w-0 flex-[1_1_320px]">
              <div className="flex items-center gap-2">
                <span className={kicker}>WhatsApp Business</span>
                <Tag tone="accent" size={10}>Oficial</Tag>
              </div>
              <h1 className={cn(h2, 'mt-3')}>Qual número você usa no WhatsApp Business?</h1>
              <p className="mt-2.5 max-w-[46ch] leading-normal text-light-neutral-400">
                Vamos ligar esse número à plataforma oficial da Meta. Ele continua funcionando no seu celular.
              </p>
              <div className="mt-[22px] max-w-[340px]">
                <label htmlFor="of-numero" className="mb-[5px] block text-[12px] text-light-text/70">
                  Número do WhatsApp Business
                </label>
                <input
                  id="of-numero"
                  className={inputCls}
                  placeholder="+55 11 90000-0000"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
              <button type="button" className={cn(btnPrimary, 'mt-4')} onClick={continuar} disabled={busy}>
                <MetaLogo size={16} />
                Continuar com a Meta
              </button>
            </div>
            <div className="flex min-w-[260px] flex-[0_1_300px] flex-col gap-3 rounded-lg border border-light-divider bg-light-bg p-[18px]">
              <div className="text-[13px] font-medium leading-tight">Antes de começar</div>
              {[
                { icon: <DeviceMobile size={14} />, text: 'O número precisa estar no app WhatsApp Business, versão atualizada.' },
                { icon: <MetaLogo size={14} />, text: 'Você vai entrar com sua conta do Facebook ou Meta Business.' },
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

        {step === 'qr' && (
          <div className="flex flex-wrap items-center gap-10">
            <div className="min-w-0 flex-[1_1_320px]">
              <h1 className={h2}>Escaneie com o WhatsApp Business</h1>
              <p className="mt-2.5 leading-normal text-light-neutral-400">Enviamos uma mensagem para {prettyPhone(numero)}.</p>
              <NumberedSteps
                items={[
                  'Abra a mensagem da Meta no WhatsApp Business e toque em Conectar à plataforma.',
                  'Toque em Escanear QR code.',
                  'Aponte a câmera para o código ao lado.',
                ]}
              />
            </div>
            <div className="flex flex-none flex-col gap-3">
              {SIMULATED ? (
                <>
                  <QrBox overlay={reading ? 'Confirmando com a Meta…' : null} />
                  <QrStatusLine>O código expira em 2 minutos</QrStatusLine>
                  <button type="button" className={cn(btnSecondary, 'w-full')} onClick={lerQr} disabled={reading}>
                    <DeviceMobileCamera size={16} />
                    Simular leitura do QR
                  </button>
                </>
              ) : (
                <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-light-divider bg-light-surface p-6 text-center">
                  {metaError ? (
                    <>
                      <p className="text-[13px] text-light-neutral-400">{metaError}</p>
                      <button type="button" className={btnSecondary} onClick={openMeta}>
                        <MetaLogo size={16} />
                        Abrir a Meta de novo
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="inline-block h-[30px] w-[30px] animate-zfSpin rounded-full border-2 border-light-accent-400 border-t-transparent" />
                      <span className="text-[13px] font-medium leading-snug">
                        {reading ? 'Confirmando com a Meta…' : 'Siga as instruções na janela da Meta'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'hist' && (
          <div className="flex flex-wrap items-start gap-9">
            <div className="min-w-0 flex-[1_1_320px]">
              <div className="flex items-center gap-2 text-[12px] text-light-accent-300">
                <CheckCircle size={14} weight="fill" />
                {prettyPhone(numero)} verificado
              </div>
              <h1 className={cn(h2, 'mt-3')}>Trazer suas conversas?</h1>
              <p className="mt-2.5 max-w-[46ch] leading-normal text-light-neutral-400">
                Podemos importar os contatos e as conversas individuais dos últimos 6 meses. Grupos não são importados.
              </p>
              <div role="radiogroup" aria-label="Importar conversas" className="mt-5 flex max-w-[420px] flex-col gap-2">
                {[
                  { value: true, title: 'Importar conversas e contatos', desc: 'Últimos 6 meses de conversas individuais' },
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
                      <span
                        className={cn(
                          'mt-px grid h-4 w-4 flex-none place-items-center rounded-pill border',
                          on ? 'border-light-accent-400' : 'border-light-neutral-700',
                        )}
                      >
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
              <button type="button" className={cn(btnPrimary, 'mt-[18px]')} onClick={concluir} disabled={busy}>
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
                Cada número tem 1.000 respostas grátis por mês. Sem forma de pagamento no Meta Business, as respostas param quando o
                limite acaba.
              </p>
              <button
                type="button"
                className="self-start border-0 bg-transparent p-0 text-[12px] text-amber-text underline"
                onClick={() =>
                  toast({
                    icon: <CreditCard size={18} weight="fill" />,
                    title: 'Meta Business',
                    text: 'Abriria a página de pagamentos da Meta',
                  })
                }
              >
                Abrir Meta Business
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
