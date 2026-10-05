import type { ReactNode } from 'react'
import Link from 'next/link'
import { Plus } from '@/components/site/ui/icons'
import { EMPRESA } from '@/components/legal/legal-layout'
import { cn } from '@/lib/utils'
import { eyebrow, h2, wrap } from '../ui/styles'

const link = 'font-medium text-light-accent-300 underline underline-offset-2 hover:text-light-accent-200'

function perguntas(essencial: string): { p: string; r: ReactNode }[] {
  return [
    { p: 'Preciso trocar de número?', r: 'Não. Você conecta o número que já usa com os clientes, escaneando um QR Code, como no WhatsApp Web.' },
    { p: 'Funciona com o WhatsApp comum ou só com o Business?', r: 'Funciona com os dois.' },
    { p: 'E se a IA não souber responder?', r: 'Ela passa a conversa para você e avisa que alguém da equipe precisa responder.' },
    { p: 'Posso responder eu mesmo?', r: 'Pode, a qualquer momento. Quando você responde, a IA sai daquela conversa até você devolver para ela.' },
    { p: 'A IA fala sobre qualquer assunto?', r: 'Não. Ela só fala sobre o seu negócio, com as informações que você ensinou.' },
    { p: 'Preciso deixar o celular ligado?', r: 'O número precisa continuar ativo no celular, como acontece no WhatsApp Web.' },
    {
      p: 'Meus dados ficam seguros?',
      r: (
        <>
          O PearChat tem login em duas etapas e faz backup diário dos dados. Os detalhes estão na{' '}
          <Link href="/privacidade" className={link}>
            Política de Privacidade
          </Link>
          .
        </>
      ),
    },
    {
      p: 'Como o PearChat usa o meu Google Agenda?',
      r: (
        <>
          Só se você quiser conectar: o PearChat vê os seus compromissos para não marcar em cima de outro horário e cria no seu Google Agenda os agendamentos feitos nele. Você desconecta quando quiser, e o uso dos dados do Google está explicado na{' '}
          <Link href="/privacidade#google" className={link}>
            Política de Privacidade
          </Link>
          .
        </>
      ),
    },
    {
      p: 'Quanto custa?',
      r: (
        <>
          Os planos começam em R$ {essencial} por mês, veja em{' '}
          <a href="#planos" className={link}>
            Planos
          </a>
          . Durante o lançamento, o uso é gratuito.
        </>
      ),
    },
  ]
}

export function Faq({ essencial }: { essencial: string }) {
  return (
    <section id="duvidas" aria-labelledby="t-faq" style={{ containIntrinsicSize: 'auto 1100px' }} className="lp-cv border-t border-light-divider bg-white py-24 min-[768px]:py-36">
      <div className={`${wrap} grid grid-cols-1 gap-12 min-[1024px]:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] min-[1024px]:gap-20`}>
        <div>
          <p className={cn(eyebrow, 'text-light-accent-300')}>Dúvidas</p>
          <h2 id="t-faq" className={cn(h2, 'mt-5')}>
            Dúvidas frequentes
          </h2>
          <p className="mt-5 max-w-[34ch] text-[16px] leading-[1.6] text-light-neutral-400">
            Ficou alguma pergunta? Escreva para{' '}
            <a href={`mailto:${EMPRESA.email}`} className={cn(link, 'break-all')}>
              {EMPRESA.email}
            </a>
            .
          </p>
        </div>
        <div className="lp-faq border-t border-light-divider">
          {perguntas(essencial).map((f) => (
            <details key={f.p} className="group border-b border-light-divider">
              <summary className="flex cursor-pointer items-center justify-between gap-6 rounded-md py-6 text-[17px] font-medium tracking-[-0.01em] min-[768px]:text-[19px]">
                {f.p}
                <span className="grid h-8 w-8 flex-none place-items-center rounded-pill border border-light-divider text-light-neutral-400 transition-[transform,background-color,color] duration-300 group-open:rotate-45 group-open:border-light-accent-700 group-open:bg-light-accent-900 group-open:text-light-accent-300">
                  <Plus size={14} weight="bold" aria-hidden="true" />
                </span>
              </summary>
              <p className="max-w-[62ch] pb-7 pr-10 text-[16px] leading-[1.65] text-light-neutral-400">{f.r}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
