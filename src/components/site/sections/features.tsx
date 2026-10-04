import type { ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import {
  ArrowsClockwise,
  Bell,
  CalendarDots,
  ChatsCircle,
  Check,
  Clock,
  GoogleLogo,
  Lightning,
  Paperclip,
  PaperPlaneTilt,
  Sparkle,
  Stack,
  Tag as TagIcon,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/utils'
import { BookingPhone, ReminderCard, WeekAgenda } from '../mini/agenda-booking'
import { Broadcast, ContactsPanel } from '../mini/broadcast-contacts'
import { AiChat, FollowupChat, FollowupRules, Inbox, KnowledgeCard } from '../mini/conversations'
import { SpacesSwitcher } from '../mini/spaces'
import { eyebrow, h2, h3, lead, wrap } from '../ui/styles'

function Eyebrow({ Icon, children }: { Icon: Icon; children: ReactNode }) {
  return (
    <p className={cn(eyebrow, 'flex items-center gap-2 text-light-accent-300')}>
      <span className="grid h-7 w-7 place-items-center rounded-[8px] border border-light-accent-700 bg-light-accent-900">
        <Icon size={15} weight="bold" aria-hidden="true" />
      </span>
      {children}
    </p>
  )
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-7 flex list-none flex-col gap-3 p-0">
      {items.map((t) => (
        <li key={t} className="flex gap-3 text-[15.5px] leading-[1.5] text-light-neutral-300">
          <span className="mt-[3px] grid h-[18px] w-[18px] flex-none place-items-center rounded-pill bg-light-accent-800 text-light-accent-200">
            <Check size={11} weight="bold" aria-hidden="true" />
          </span>
          {t}
        </li>
      ))}
    </ul>
  )
}

function Fact({ Icon, title, children }: { Icon: Icon; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <span className="grid h-10 w-10 flex-none place-items-center rounded-[11px] border border-light-divider bg-white text-light-accent-300 shadow-[0_1px_2px_rgba(29,33,23,.05)]">
        <Icon size={19} aria-hidden="true" />
      </span>
      <div>
        <h4 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h4>
        <p className="mt-1 text-[14px] leading-[1.55] text-light-neutral-400">{children}</p>
      </div>
    </div>
  )
}

/** Visual ilustrativo: escondido do leitor de tela, com um texto alternativo curto. */
function Visual({ alt, className, children }: { alt: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative', className)}>
      <p className="sr-only">{alt}</p>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

export function Features() {
  return (
    <section id="funcionalidades" aria-labelledby="t-funcionalidades" className="relative bg-light-bg pb-16 pt-24 min-[768px]:pb-24 min-[768px]:pt-36">
      <div className={wrap}>
        <div className="mx-auto max-w-[820px] text-center">
          <p className={cn(eyebrow, 'text-light-accent-300')}>Funcionalidades</p>
          <h2 id="t-funcionalidades" className={cn(h2, 'mt-5')}>
            Tudo o que o seu atendimento precisa, funcionando junto.
          </h2>
        </div>

        {/* 1. Agente de IA */}
        <article className="mt-20 grid grid-cols-1 items-center gap-12 min-[1024px]:mt-32 min-[1024px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[1024px]:gap-16">
          <div>
            <Eyebrow Icon={Sparkle}>Agente de IA</Eyebrow>
            <h3 className={cn(h3, 'mt-5')}>Ensine uma vez. Deixe a IA responder.</h3>
            <p className={cn(lead, 'mt-5')}>
              Você escreve os horários, serviços, preços e respostas do seu negócio. A IA atende com essas informações, a qualquer hora, e só fala sobre o
              que é seu.
            </p>
            <Points
              items={[
                'Passa a conversa para você quando precisa.',
                'Você assume quando quiser e depois devolve para a IA.',
                'Marca, remarca e cancela horários, sempre pedindo confirmação.',
              ]}
            />
          </div>
          <Visual alt="Exemplo: a cliente pergunta se atendem sábado e se há horário às 14h; a IA responde e pede confirmação." className="min-[640px]:pb-16">
            <AiChat className="min-[1024px]:ml-auto min-[1024px]:max-w-[620px]" />
            <KnowledgeCard className="mt-4 min-[640px]:absolute min-[640px]:bottom-0 min-[640px]:left-[-20px] min-[640px]:mt-0 min-[640px]:w-[400px]" />
          </Visual>
        </article>

        {/* 2. Agenda + link + confirmação */}
        <article className="mt-32 min-[1024px]:mt-48">
          <div className="grid grid-cols-1 gap-8 min-[1024px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-[1024px]:items-end">
            <div>
              <Eyebrow Icon={CalendarDots}>Agenda e link de agendamento</Eyebrow>
              <h3 className={cn(h3, 'mt-5 max-w-[20ch]')}>Seu próximo agendamento pode acontecer sem você abrir o WhatsApp.</h3>
            </div>
            <p className={lead}>
              A IA consulta os horários livres e marca pela conversa. Quem prefere escolhe sozinho pelo seu link de agendamento. Tudo cai na mesma agenda.
            </p>
          </div>
          <Visual
            alt="Agenda da semana com um novo agendamento de Mariana Silva às 14:00, já confirmado, ao lado de um celular com a página pública de agendamento."
            className="mt-14 min-[1100px]:pr-[250px]"
          >
            <WeekAgenda />
            <div className="mt-6 flex flex-col items-center gap-6 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-center min-[1100px]:mt-0">
              <BookingPhone className="w-[290px] flex-none min-[1100px]:absolute min-[1100px]:-top-10 min-[1100px]:right-0" />
              <ReminderCard className="w-[min(330px,100%)] min-[1100px]:absolute min-[1100px]:-bottom-12 min-[1100px]:-left-8" />
            </div>
          </Visual>
          <div className="mt-16 grid grid-cols-1 gap-8 min-[720px]:grid-cols-3 min-[1100px]:mt-24">
            <Fact Icon={Clock} title="Tipos de atendimento">
              Cada serviço com a sua duração. Você cria e edita quando quiser.
            </Fact>
            <Fact Icon={GoogleLogo} title="Google Agenda">
              Conecte a sua conta e veja os compromissos na mesma agenda.
            </Fact>
            <Fact Icon={Bell} title="Lembrete e confirmação">
              O lembrete sai sozinho e pede 1 para confirmar ou 2 para remarcar.
            </Fact>
          </div>
        </article>

        {/* 3. Follow-up */}
        <article className="mt-32 grid grid-cols-1 items-center gap-12 min-[1024px]:mt-48 min-[1024px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-[1024px]:gap-16">
          <Visual
            alt="Conversa parada: a cliente diz que vai pensar, passam 2 horas sem resposta, o follow-up automático pergunta se ela conseguiu analisar e ela responde."
            className="order-2 min-[1024px]:order-1"
          >
            <div className="flex flex-col gap-4 min-[720px]:flex-row min-[720px]:items-start">
              <FollowupChat className="min-w-0 flex-1" />
              <FollowupRules className="w-full flex-none min-[720px]:-ml-4 min-[720px]:mt-24 min-[720px]:w-[250px]" />
            </div>
          </Visual>
          <div className="order-1 min-[1024px]:order-2">
            <Eyebrow Icon={ArrowsClockwise}>Follow-up automático</Eyebrow>
            <h3 className={cn(h3, 'mt-5')}>Pare de perder clientes que pararam de responder.</h3>
            <p className={cn(lead, 'mt-5')}>
              Quando a conversa esfria, o PearChat retoma no tempo e do jeito que você definir. Se alguém da equipe assume a conversa, o follow-up para.
            </p>
          </div>
        </article>

        {/* 4. Central de conversas e equipe */}
        <article className="mt-32 min-[1024px]:mt-48">
          <div className="mx-auto max-w-[760px] text-center">
            <div className="flex justify-center">
              <Eyebrow Icon={ChatsCircle}>Central de conversas e equipe</Eyebrow>
            </div>
            <h3 className={cn(h3, 'mt-5')}>Todas as suas conversas em uma única tela.</h3>
            <p className={cn(lead, 'mx-auto mt-5 max-w-[60ch]')}>
              As mensagens do WhatsApp chegam em tempo real, com imagens, áudios e documentos. Sua equipe atende junto, e cada conversa tem um responsável.
            </p>
          </div>
          <Visual
            alt="Tela de conversas: lista à esquerda; na conversa aberta, uma foto e um áudio da cliente, a IA passando a conversa para Bruno, e o menu de respostas rápidas aberto."
            className="mt-14"
          >
            <Inbox />
          </Visual>
          <div className="mt-14 grid grid-cols-1 gap-8 min-[720px]:grid-cols-3">
            <Fact Icon={Paperclip} title="Imagens, áudios e documentos">
              Receba e envie arquivos sem sair da conversa.
            </Fact>
            <Fact Icon={Lightning} title="Respostas rápidas">
              Digite / e escolha uma resposta pronta.
            </Fact>
            <Fact Icon={UsersThree} title="Equipe na mesma conta">
              Dono, administrador e atendente. No filtro “Minhas”, cada um vê as suas conversas.
            </Fact>
          </div>
        </article>

        {/* 5 e 6. Avisos para clientes + Contatos */}
        <div className="mt-32 grid grid-cols-1 gap-20 min-[1024px]:mt-48 min-[1024px]:grid-cols-2 min-[1024px]:gap-12">
          <article>
            <Eyebrow Icon={PaperPlaneTilt}>Avisos para clientes</Eyebrow>
            <h3 className={cn(h3, 'mt-5')}>Avise todos de uma vez, sem incomodar ninguém.</h3>
            <p className={cn(lead, 'mt-5')}>
              Feriado, mudança de horário, novidade: escreva uma vez e agende o envio para uma lista. O envio tem intervalo entre as mensagens, pausa à
              noite e respeita quem pede para parar.
            </p>
            <Visual alt="Aviso de horário de feriado agendado para hoje às 18:00, para 86 contatos, com intervalo e horário de silêncio." className="mt-10">
              <Broadcast />
            </Visual>
          </article>
          <article className="min-[1024px]:pt-40">
            <Eyebrow Icon={TagIcon}>Contatos</Eyebrow>
            <h3 className={cn(h3, 'mt-5')}>Sua base de clientes organizada.</h3>
            <p className={cn(lead, 'mt-5')}>Etiquetas para separar clientes, leads e agendamentos. Busca rápida e importação por planilha.</p>
            <Visual alt="Lista de contatos com etiquetas Cliente, Lead, Agendamento e VIP, campo de busca e botão Importar planilha." className="mt-10">
              <ContactsPanel />
            </Visual>
          </article>
        </div>

        {/* 7. Vários WhatsApps */}
        <article className="mt-32 overflow-hidden rounded-[28px] border border-light-accent-700/60 bg-[linear-gradient(160deg,#f0faea_0%,#ffffff_60%)] p-6 min-[768px]:p-12 min-[1024px]:mt-48 min-[1200px]:p-16">
          <div className="grid grid-cols-1 items-center gap-12 min-[1100px]:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <div>
              <Eyebrow Icon={Stack}>Vários WhatsApps</Eyebrow>
              <h3 className={cn(h3, 'mt-5')}>Mais de um número, cada um no seu espaço.</h3>
              <p className={cn(lead, 'mt-5')}>
                Cada WhatsApp tem as suas conversas, IA, follow-up, contatos e agenda. Troque de número com um clique.
              </p>
              <p className="mt-6 inline-flex items-center gap-2 rounded-pill border border-light-divider bg-white px-3.5 py-2 text-[13px] text-light-neutral-400">
                1, 3 ou 5 números, conforme o plano
              </p>
              <p className="mt-6 hidden text-[13px] text-light-neutral-500 min-[1100px]:block">Experimente: escolha um número ao lado.</p>
            </div>
            <div>
              <p className="sr-only">Exemplo interativo: escolha entre os WhatsApps Loja Centro, Atendimento e Comercial para ver as conversas de cada um.</p>
              <SpacesSwitcher />
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}
