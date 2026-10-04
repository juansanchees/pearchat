'use client'
import type { ReactNode } from 'react'
import { ArrowRight, Check, Info, QrCode, SealCheck, Warning } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { cn } from '@/lib/utils'
import type { ProviderKind } from '@/lib/types'
import { kicker, pageShell, Tag } from './ui'

type Perk = { icon: ReactNode; text: string }

function Card({
  recommended,
  icon,
  title,
  subtitle,
  tag,
  perks,
  cta,
  onClick,
  disabled,
}: {
  recommended?: boolean
  icon: ReactNode
  title: string
  subtitle: string
  tag: ReactNode
  perks: Perk[]
  cta?: string
  onClick?: () => void
  /** Indisponível por enquanto (ex.: Meta ainda não configurada): não clicável, opacidade reduzida. */
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(
        'flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-lg border p-[22px] text-left text-light-text transition-[border-color,box-shadow] duration-200',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-light-accent-500 hover:shadow-[0_10px_30px_rgba(29,33,23,.08)]',
        recommended ? 'border-light-accent-600 bg-[color-mix(in_srgb,#2e9a48_7%,#ffffff)]' : 'border-light-divider bg-light-surface',
      )}
    >
      <div className="flex w-full items-center gap-3">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-xl border border-light-accent-700 bg-light-accent-900 text-light-accent-300">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-medium leading-tight">{title}</span>
          <span className="mt-[3px] block text-[12px] text-light-neutral-500">{subtitle}</span>
        </span>
        {tag}
      </div>
      <ul className="flex flex-col gap-2">
        {perks.map((p) => (
          <li key={p.text} className="flex gap-2 text-[12.5px] leading-[1.4] text-light-neutral-300">
            <span className="mt-px flex-none">{p.icon}</span>
            {p.text}
          </li>
        ))}
      </ul>
      {cta && !disabled ? (
        <span className="mt-auto flex items-center gap-1.5 pt-1 text-[13px] font-medium leading-none text-light-accent-300">
          {cta}
          <ArrowRight size={13} />
        </span>
      ) : null}
    </button>
  )
}

const ok = <Check size={14} className="text-light-accent-300" />

export function Chooser({ onPick }: { onPick: (p: ProviderKind) => void }) {
  const { connectCfg } = useAppState()
  // Oficial só existe de verdade com a Meta configurada (ou no modo demo, que simula).
  const oficialOk = connectCfg.demo || connectCfg.metaConfigured
  return (
    <div className={pageShell}>
      <div className="flex w-[min(860px,100%)] animate-zfIn flex-col gap-[22px]">
        <div>
          <div className={kicker}>Primeiro passo</div>
          <h1 className="mt-3 text-[30px] font-medium leading-[1.15] tracking-[-.02em]">Conecte seu WhatsApp</h1>
          <p className="mt-2.5 max-w-[56ch] leading-normal text-light-neutral-400 [text-wrap:pretty]">
            Escolha como conectar. Nos dois casos você lê um QR code com o celular e continua usando o WhatsApp normalmente.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Card
            recommended={oficialOk}
            disabled={!oficialOk}
            icon={<SealCheck size={21} />}
            title="WhatsApp Business oficial"
            subtitle="Pela plataforma da Meta"
            tag={oficialOk ? <Tag tone="accent" size={10.5}>Recomendado</Tag> : <Tag tone="neutral" size={10.5}>Em breve</Tag>}
            perks={[
              { icon: ok, text: 'Aprovado pela Meta, sem risco de bloqueio por uso de API' },
              { icon: ok, text: 'Disparos com modelos aprovados e mais estabilidade' },
              { icon: ok, text: 'Continua usando o app WhatsApp Business no celular' },
              { icon: <Info size={14} className="text-light-neutral-500" />, text: '1.000 respostas grátis por mês, depois cobradas pela Meta' },
            ]}
            cta="Conectar oficial"
            onClick={oficialOk ? () => onPick('oficial') : undefined}
          />
          <Card
            icon={<QrCode size={21} />}
            recommended={!oficialOk}
            title="Conexão rápida por QR"
            subtitle="Pelo WhatsApp Web"
            tag={<Tag tone="neutral" size={10.5}>Não oficial</Tag>}
            perks={[
              { icon: ok, text: 'Pronto em 1 minuto, funciona com WhatsApp comum ou Business' },
              { icon: ok, text: 'Sem custo por mensagem' },
              { icon: <Warning size={14} color="#b0872f" />, text: 'Não aprovado pela Meta: disparos em massa podem bloquear o número' },
            ]}
            cta="Conectar por QR"
            onClick={() => onPick('rapida')}
          />
        </div>
        {!oficialOk && (
          <p className="text-[12.5px] text-light-neutral-400">
            Estamos finalizando a aprovação com a Meta. Por enquanto, use a conexão rápida por QR.
          </p>
        )}
        <p className="text-[11.5px] text-light-neutral-500">Você pode trocar o tipo de conexão depois, em Configurações.</p>
      </div>
    </div>
  )
}
