'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DeviceMobileCamera, Warning, WhatsappLogo } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import type { WhatsAppStatusDTO } from '@/lib/types'
import { errMessage, waApi } from './api'
import { BackLink, btnSecondary, kicker, NumberedSteps, pageShell, QrBox, QrStatusLine, Tag } from './ui'
import { useLater } from './use-later'

const POLL_MS = 5000

export function RapidaFlow({ onBack }: { onBack: () => void }) {
  const { setWa, toast, user, connectCfg } = useAppState()
  // "Simular leitura do QR" só existe no modo demo (decidido pelo servidor a cada requisição).
  const MOCK = connectCfg.demo
  const later = useLater()
  const [qr, setQr] = useState<string | undefined>()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const done = useRef(false)
  const simulating = useRef(false)

  const onConnected = useCallback(
    (dto: WhatsAppStatusDTO) => {
      if (done.current) return
      done.current = true
      setWa(dto)
      toast({
        icon: <WhatsappLogo size={18} weight="fill" />,
        title: 'WhatsApp conectado',
        text: `${user.empresa} · ${dto.numero ?? ''}`.replace(/ · $/, ''),
      })
    },
    [setWa, toast, user.empresa],
  )

  // Pede o QR e acompanha o status por polling; tudo é cancelado ao desmontar ou ao trocar de tipo.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    setError(null)

    const poll = async () => {
      try {
        const dto = await waApi.status()
        if (cancelled) return
        if (dto.status === 'conectado') return onConnected(dto)
        if (dto.qr) setQr(dto.qr)
        if (!simulating.current) setReading(dto.status === 'conectando')
      } catch {
        // falha transitória: tenta de novo no próximo ciclo
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS)
    }

    waApi
      .connect('rapida')
      .then((dto) => {
        if (cancelled) return
        setQr(dto.qr)
        timer = window.setTimeout(poll, POLL_MS)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errMessage(e))
      })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [attempt, onConnected])

  const simulate = () => {
    if (reading) return
    simulating.current = true
    setReading(true)
    later(() => {
      waApi
        .mockScan()
        .then(onConnected)
        .catch((e: unknown) => {
          simulating.current = false
          setReading(false)
          toast({ title: 'Não foi possível simular', text: errMessage(e) })
        })
    }, 1700)
  }

  return (
    <div className={pageShell}>
      <div className="flex w-[min(880px,100%)] animate-zfIn flex-wrap items-center gap-10 rounded-md bg-light-surface p-9 shadow-md">
        <div className="min-w-0 flex-[1_1_320px]">
          <BackLink onClick={onBack} className="mb-4" />
          <div className="flex items-center gap-2">
            <span className={kicker}>Conexão rápida</span>
            <Tag tone="neutral" size={10}>Não oficial</Tag>
          </div>
          <h1 className="mt-3 text-[30px] font-medium leading-[1.15] tracking-[-.02em]">Conecte seu WhatsApp</h1>
          <p className="mt-2.5 max-w-[44ch] leading-normal text-light-neutral-400">
            Escaneie o código com o celular. Suas conversas abrem aqui e você liga as automações pelo menu lateral.
          </p>
          <NumberedSteps
            items={[
              'Abra o WhatsApp no celular que você usa para atender clientes.',
              'Vá em Configurações e toque em Dispositivos conectados.',
              'Toque em Conectar um dispositivo e aponte a câmera para o código ao lado.',
            ]}
          />
          <div className="mt-6 flex gap-2.5 rounded-md border border-amber-border bg-amber-bg px-3.5 py-3 text-[12px] leading-[1.45] text-amber-text">
            <Warning size={15} className="mt-px flex-none" />
            <span>
              Essa conexão não é aprovada pela Meta. Envios em massa podem levar ao bloqueio do número. Para disparos frequentes,
              prefira a conexão oficial.
            </span>
          </div>
        </div>

        <div className="mx-auto flex flex-none flex-col gap-3">
          {error ? (
            <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-3 rounded-lg border border-light-divider bg-light-surface p-6 text-center">
              <p className="text-[13px] text-light-neutral-400">{error}</p>
              <button type="button" className={btnSecondary} onClick={() => setAttempt((n) => n + 1)}>
                Tentar de novo
              </button>
            </div>
          ) : (
            <QrBox src={qr} overlay={reading ? 'Conectando…' : null} />
          )}
          {!error && <QrStatusLine>{reading ? 'Lendo código, aguarde…' : 'Aguardando leitura do código'}</QrStatusLine>}
          {MOCK && !error && (
            <button type="button" className={`${btnSecondary} w-full`} onClick={simulate} disabled={reading}>
              <DeviceMobileCamera size={16} />
              Simular leitura do QR
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
