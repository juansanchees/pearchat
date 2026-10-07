'use client'

import { Info } from '@phosphor-icons/react'
import { useAppState } from '@/components/app/app-state'
import { Pill } from '@/components/pear'
import { api } from './api'
import { useDrawerData, useDrawerLoad } from './drawer-data'
import { FU_PARAR_OPCOES } from './mock-data'
import { DrawerShell, Field, SaveFooter, Section, Seg } from './parts'
import { fmtQuando } from './view'

const ESPERAS = ['2 h', '6 h', '24 h'] as const
const TENTATIVAS = ['1', '2', '3'] as const

export function FollowupDrawer() {
  const { wa, connected, automations, locale } = useAppState()
  const { fu, setFu, fuParar, setFuParar, fuFila } = useDrawerData()
  const loading = useDrawerLoad('followup')
  const n = Number(fu.tentativas)
  const ativo = connected && automations.followup

  const salvar = async () => {
    await api('/api/followup', {
      method: 'PUT',
      body: {
        esperaHoras: parseInt(fu.espera, 10),
        tentativas: n,
        mensagens: fu.msgs,
        stopConditions: fuParar,
      },
    })
  }

  return (
    <DrawerShell id="followup" loading={loading} footer={<SaveFooter titulo="Follow-up automático" onSave={salvar} />}>
      <div className="rounded-lg border border-light-accent-700 bg-light-accent-900 px-4 py-[14px] text-[12.5px] leading-[1.5] text-light-accent-200">
        Quando um cliente para de responder, o PearChat manda uma mensagem de retomada no tempo que você definir. Para assim que ele responder.
      </div>

      {wa.provider === 'oficial' && (
        <div className="pc-note flex gap-[9px]">
          <Info size={15} className="mt-px flex-none text-light-accent-300" />
          <span>
            Após 24 h sem resposta, o WhatsApp oficial só aceita modelos aprovados. As tentativas depois disso usam o modelo{' '}
            <b>retomada_conversa</b>.
          </span>
        </div>
      )}

      <Section label="Regras" gap="gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Se não responder em" className="min-w-0 flex-[1_1_200px]">
            <Seg options={ESPERAS} value={fu.espera as (typeof ESPERAS)[number]} onChange={(v) => setFu((f) => ({ ...f, espera: v }))} label="Se não responder em" />
          </Field>
          <Field label="Tentativas" className="min-w-0 flex-[1_1_160px]">
            <Seg options={TENTATIVAS} value={fu.tentativas as (typeof TENTATIVAS)[number]} onChange={(v) => setFu((f) => ({ ...f, tentativas: v }))} label="Tentativas" />
          </Field>
        </div>
      </Section>

      <Section label="Mensagens de retomada" gap="gap-0">
        {fu.msgs.slice(0, n).map((m, i, arr) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="grid h-6 w-6 flex-none place-items-center rounded-pill border border-light-accent-700 bg-light-accent-900 text-[11px] font-medium leading-none text-light-accent-200">
                {i + 1}
              </span>
              {i < arr.length - 1 && <span className="mt-1 w-px flex-1 bg-light-divider" />}
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <div className="mb-[6px] text-[11.5px] text-light-neutral-500">
                {i === 0 ? `Após ${fu.espera} sem resposta` : `Se continuar sem resposta, mais ${fu.espera} depois`}
              </div>
              <textarea
                className="pc-input"
                rows={2}
                aria-label={`Mensagem de retomada ${i + 1}`}
                value={m}
                onChange={(e) => setFu((f) => ({ ...f, msgs: f.msgs.map((x, j) => (j === i ? e.target.value : x)) }))}
              />
            </div>
          </div>
        ))}
      </Section>

      <Section label="Parar quando">
        <div className="flex flex-wrap gap-2">
          {FU_PARAR_OPCOES.map((o) => (
            <Pill
              key={o}
              variant="chip"
              active={fuParar.includes(o)}
              onClick={() => setFuParar((l) => (l.includes(o) ? l.filter((x) => x !== o) : [...l, o]))}
            >
              {o}
            </Pill>
          ))}
        </div>
      </Section>

      <Section label="Próximos envios">
        {fuFila.length === 0 && (
          <div className="pc-note">Nenhum envio programado no momento. Quando um cliente parar de responder, ele aparece aqui.</div>
        )}
        {fuFila.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-[10px] rounded-md border border-light-divider px-3 py-[10px]"
            style={{ opacity: ativo ? 1 : 0.55 }}
          >
            <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-pill bg-light-neutral-900 text-[11px] text-light-accent-200">{f.sigla}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium leading-[1.25]">{f.nome}</div>
              <div className="truncate text-[11px] text-light-neutral-500">{f.tentativa}ª tentativa</div>
            </div>
            <span className="flex-none text-[11.5px] text-light-neutral-400">{ativo ? fmtQuando(f.runAt, new Date(), locale.timezone) : 'Pausado'}</span>
          </div>
        ))}
      </Section>
    </DrawerShell>
  )
}
