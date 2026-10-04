import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarDots,
  CaretDown,
  ChatCircleDots,
  Check,
  Cake,
  FirstAidKit,
  ForkKnife,
  HairDryer,
  LinkSimple,
  PaperPlaneTilt,
  PawPrint,
  QrCode,
  Scissors,
  ShieldCheck,
  Sparkle,
  Storefront,
  Stack,
  Tag,
  Wrench,
  ArrowsClockwise,
  WhatsappLogo,
} from '@phosphor-icons/react/dist/ssr'
import { Logo } from '@/components/brand/logo'
import { EMPRESA } from '@/components/legal/legal-layout'
import { PLANOS } from '@/components/drawers/mock-data'
import { HeroMockup } from './hero-mockup'
import { PricingNotice } from './pricing-notice'

const wrap = 'mx-auto w-full max-w-[1120px] px-5 min-[800px]:px-8'
const cta =
  'inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-[14.5px] font-medium leading-none transition-colors'
const ctaPrimary = `${cta} bg-light-accent-fill text-white hover:bg-light-accent-fillHover active:bg-light-accent-fillActive`
const ctaSecondary = `${cta} border border-light-divider bg-light-surface text-light-text hover:border-light-neutral-700`

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto mb-10 max-w-[640px] text-center">
      <p className="pc-section-label !text-light-accent-300">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-balance text-[28px] font-medium leading-[1.15] tracking-[-0.02em] min-[800px]:text-[34px]">
        {title}
      </h2>
      {children && <p className="mt-3 text-[15px] leading-[1.6] text-light-neutral-400 [text-wrap:pretty]">{children}</p>}
    </div>
  )
}

const RECURSOS = [
  { Icon: Sparkle, titulo: 'Agente de IA', texto: 'Responde com as informações do seu negócio, a qualquer hora, e passa a conversa para você quando precisa.' },
  { Icon: ChatCircleDots, titulo: 'Conversas em um só lugar', texto: 'Acompanhe tudo em tempo real, com imagens, áudios e documentos, e assuma qualquer conversa quando quiser.' },
  { Icon: CalendarDots, titulo: 'Agenda', texto: 'Tipos de atendimento, Google Agenda conectado e lembretes automáticos para os clientes.' },
  { Icon: LinkSimple, titulo: 'Link de agendamento', texto: 'Uma página pública para o cliente escolher o horário sozinho, sem precisar conversar.' },
  { Icon: ArrowsClockwise, titulo: 'Follow-up automático', texto: 'Retoma a conversa de quem parou de responder, no tempo e do jeito que você definir.' },
  { Icon: PaperPlaneTilt, titulo: 'Disparos', texto: 'Mensagens para listas de clientes, agendadas, com horário de silêncio para não incomodar de madrugada.' },
  { Icon: Tag, titulo: 'Contatos', texto: 'Etiquetas para organizar a base e importação de contatos por planilha.' },
  { Icon: Stack, titulo: 'Vários WhatsApps', texto: 'Mais de um número na mesma conta, cada um com a sua conversa, agenda e configurações.' },
]

const PASSOS = [
  { Icon: QrCode, titulo: 'Conecte o WhatsApp', texto: 'Escaneie o QR Code com o celular, como no WhatsApp Web. Leva um minuto.' },
  { Icon: Sparkle, titulo: 'Ensine o agente', texto: 'Escreva as instruções e as perguntas frequentes do seu negócio: horários, preços, endereço, regras.' },
  { Icon: ArrowsClockwise, titulo: 'Ligue as automações', texto: 'Ative a IA, o follow-up e os disparos quando quiser. Você pode desligar tudo a qualquer momento.' },
]

const SEGMENTOS = [
  { Icon: Scissors, nome: 'Barbearias' },
  { Icon: HairDryer, nome: 'Beleza e estética' },
  { Icon: PawPrint, nome: 'Pet shops' },
  { Icon: FirstAidKit, nome: 'Clínicas e saúde' },
  { Icon: ForkKnife, nome: 'Restaurantes e delivery' },
  { Icon: Cake, nome: 'Confeitarias' },
  { Icon: Storefront, nome: 'Lojas' },
  { Icon: Wrench, nome: 'Serviços' },
]

const FAQ = [
  {
    p: 'Preciso deixar o celular ligado?',
    r: 'Na conexão rápida (por QR Code), o WhatsApp do seu celular precisa continuar conectado à internet de tempos em tempos, como acontece com o WhatsApp Web. Na conexão oficial da Meta, que chega em breve, o celular não é necessário.',
  },
  {
    p: 'Posso usar o meu número atual?',
    r: 'Sim. Você conecta o número que já usa com os clientes, escaneando o QR Code. Recomendamos um número do próprio negócio.',
  },
  {
    p: 'A IA inventa respostas?',
    r: 'O agente responde com base nas instruções e nas perguntas frequentes que você cadastra. Quando não souber ou o assunto pedir uma pessoa, ele passa a conversa para você. Vale revisar as conversas no começo e ajustar as instruções.',
  },
  {
    p: 'Consigo assumir uma conversa?',
    r: 'Sim, a qualquer momento. Você abre a conversa, assume o atendimento e a IA deixa de responder naquele contato até você devolver.',
  },
  {
    p: 'Meus dados ficam seguros?',
    r: 'Os dados ficam em servidor protegido, com acesso por senha e opção de verificação em duas etapas. Os detalhes de como tratamos os dados estão na Política de Privacidade, de acordo com a LGPD.',
  },
  {
    p: 'Como eu cancelo?',
    r: 'Você pode desconectar o WhatsApp e encerrar o uso quando quiser, sem multa. Para pedir a exclusão da conta e dos dados, fale com a gente pelo e-mail de contato.',
  },
]

function LogoLink() {
  return (
    <Link href="/" className="-ml-1 flex items-center rounded-md" aria-label="PearChat, página inicial">
      <Logo theme="light" height={36} priority />
    </Link>
  )
}

export function Landing() {
  return (
    <div className="min-h-screen bg-light-bg text-[14px] text-light-text">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-light-surface focus:px-3 focus:py-2">
        Ir para o conteúdo
      </a>

      <header className="sticky top-0 z-40 border-b border-light-divider bg-light-bg/90 backdrop-blur">
        <div className={`${wrap} flex h-16 items-center gap-6`}>
          <LogoLink />
          <nav aria-label="Seções" className="hidden items-center gap-6 text-[13.5px] text-light-neutral-400 min-[900px]:flex">
            <a href="#recursos" className="rounded-sm hover:text-light-text">Recursos</a>
            <a href="#como-funciona" className="rounded-sm hover:text-light-text">Como funciona</a>
            <a href="#planos" className="rounded-sm hover:text-light-text">Planos</a>
            <a href="#perguntas" className="rounded-sm hover:text-light-text">Perguntas</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="rounded-md px-3 py-2 text-[13.5px] font-medium text-light-neutral-300 hover:text-light-text">
              Entrar
            </Link>
            <Link href="/registro" className={`${ctaPrimary} !px-4 !py-2.5 !text-[13.5px]`}>
              <span className="max-[479px]:hidden">Criar conta grátis</span>
              <span className="min-[480px]:hidden">Criar conta</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="conteudo">
        {/* Herói */}
        <section aria-labelledby="titulo-principal" className="overflow-hidden">
          <div className={`${wrap} grid items-center gap-12 py-14 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] min-[1000px]:py-20`}>
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-pill border border-light-accent-700 bg-light-accent-900 px-3 py-1.5 text-[12px] text-light-accent-300">
                <WhatsappLogo size={14} weight="fill" aria-hidden="true" /> Atendimento pelo WhatsApp
              </p>
              <h1 id="titulo-principal" className="mt-5 text-balance text-[36px] font-medium leading-[1.08] tracking-[-0.025em] min-[800px]:text-[50px]">
                Seu WhatsApp atendendo, agendando e vendendo por você
              </h1>
              <p className="mt-5 max-w-[48ch] text-[16.5px] leading-[1.6] text-light-neutral-400 [text-wrap:pretty]">
                Conecte o número do seu negócio, ensine o agente de IA e acompanhe conversas, agenda e disparos em uma tela só.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/registro" className={ctaPrimary}>
                  Criar conta grátis <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a href="#como-funciona" className={ctaSecondary}>
                  Ver como funciona
                </a>
              </div>
              <p className="mt-4 text-[12.5px] text-light-neutral-400">Sem cartão de crédito. Durante o lançamento, o uso é gratuito.</p>
            </div>
            <HeroMockup />
          </div>
        </section>

        {/* Recursos */}
        <section id="recursos" aria-labelledby="t-recursos" className="border-y border-light-divider bg-light-surface py-16 min-[800px]:py-20">
          <div className={wrap}>
            <SectionHead id="t-recursos" eyebrow="Recursos" title="Tudo o que o atendimento do seu negócio precisa">
              Cada recurso funciona com o seu WhatsApp, sem trocar de ferramenta.
            </SectionHead>
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[600px]:grid-cols-2 min-[1000px]:grid-cols-4">
              {RECURSOS.map(({ Icon, titulo, texto }) => (
                <li key={titulo} className="rounded-lg border border-light-divider bg-light-bg p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-light-accent-700 bg-light-accent-900 text-light-accent-300">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-[15.5px] font-medium">{titulo}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-[1.55] text-light-neutral-400">{texto}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" aria-labelledby="t-como" className="py-16 min-[800px]:py-20">
          <div className={wrap}>
            <SectionHead id="t-como" eyebrow="Como funciona" title="Comece em três passos" />
            <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[800px]:grid-cols-3">
              {PASSOS.map(({ Icon, titulo, texto }, i) => (
                <li key={titulo} className="rounded-lg border border-light-divider bg-light-surface p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-pill bg-light-accent-fill text-[13px] font-medium text-white" aria-hidden="true">
                      {i + 1}
                    </span>
                    <Icon size={22} className="text-light-accent-300" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-[16.5px] font-medium">{titulo}</h3>
                  <p className="mt-1.5 text-[14px] leading-[1.55] text-light-neutral-400">{texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Para quem é */}
        <section aria-labelledby="t-quem" className="border-y border-light-divider bg-light-surface py-14">
          <div className={wrap}>
            <SectionHead id="t-quem" eyebrow="Para quem é" title="Feito para negócios que vendem e agendam pelo WhatsApp" />
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2.5 p-0">
              {SEGMENTOS.map(({ Icon, nome }) => (
                <li key={nome} className="inline-flex items-center gap-2 rounded-pill border border-light-divider bg-light-bg px-4 py-2 text-[13.5px]">
                  <Icon size={16} className="text-light-accent-300" aria-hidden="true" />
                  {nome}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" aria-labelledby="t-planos" className="py-16 min-[800px]:py-20">
          <div className={wrap}>
            <SectionHead id="t-planos" eyebrow="Planos" title="Planos simples, por número de WhatsApp" />
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[800px]:grid-cols-3">
              {PLANOS.map((p) => {
                const [valor, periodo] = p.preco.split('/')
                const destaque = p.nome === 'Pro'
                return (
                  <li
                    key={p.nome}
                    className={`flex flex-col rounded-lg border bg-light-surface p-6 ${destaque ? 'border-light-accent-500 shadow-md' : 'border-light-divider'}`}
                  >
                    <h3 className="flex items-center gap-2 text-[17px] font-medium">
                      {p.nome}
                      {destaque && <span className="rounded-pill bg-light-accent-900 px-2 py-0.5 text-[10.5px] font-medium text-light-accent-300">Mais escolhido</span>}
                    </h3>
                    <p className="mt-3 flex items-baseline gap-1">
                      <span className="text-[34px] font-medium leading-none tracking-[-0.02em]">{valor}</span>
                      <span className="text-[13.5px] text-light-neutral-400">/{periodo}</span>
                    </p>
                    <p className="mt-4 flex gap-2 text-[14px] leading-[1.55] text-light-neutral-300">
                      <Check size={16} weight="bold" className="mt-[3px] flex-none text-light-accent-400" aria-hidden="true" />
                      {p.desc}
                    </p>
                    <Link href="/registro" className={`${destaque ? ctaPrimary : ctaSecondary} mt-6`}>
                      Começar grátis
                    </Link>
                  </li>
                )
              })}
            </ul>
            <PricingNotice />
          </div>
        </section>

        {/* Transparência sobre o WhatsApp */}
        <section aria-labelledby="t-whats" className="bg-dark-bg py-16 text-dark-text" style={{ background: 'radial-gradient(700px 420px at 10% 0%, #173322, transparent 70%), #14170f' }}>
          <div className={wrap}>
            <div className="mx-auto mb-10 max-w-[640px] text-center">
              <p className="text-[11px] font-medium uppercase leading-none tracking-[.12em] text-dark-accent-400">Transparência</p>
              <h2 id="t-whats" className="mt-3 text-balance text-[28px] font-medium leading-[1.15] tracking-[-0.02em] min-[800px]:text-[34px]">
                Duas formas de conectar o WhatsApp
              </h2>
            </div>
            <div className="grid gap-4 min-[800px]:grid-cols-2">
              <div className="rounded-lg border border-dark-divider bg-dark-surface p-6">
                <QrCode size={24} className="text-dark-accent-400" aria-hidden="true" />
                <h3 className="mt-3 text-[16.5px] font-medium">Conexão rápida, por QR Code</h3>
                <p className="mt-2 text-[14px] leading-[1.6] text-dark-neutral-300">
                  Disponível hoje. Funciona como o WhatsApp Web e é uma conexão <strong className="font-medium text-dark-text">não oficial</strong>: não é um produto da Meta. Use com bom senso, evite mensagens em massa para quem não conhece o seu negócio e respeite as regras do WhatsApp.
                </p>
              </div>
              <div className="rounded-lg border border-dark-divider bg-dark-surface p-6">
                <ShieldCheck size={24} className="text-dark-accent-400" aria-hidden="true" />
                <h3 className="mt-3 text-[16.5px] font-medium">Conexão oficial da Meta, em breve</h3>
                <p className="mt-2 text-[14px] leading-[1.6] text-dark-neutral-300">
                  A integração com a API oficial do WhatsApp Business está em desenvolvimento e ainda não está disponível. Quando chegar, será uma opção a mais para quem prefere o canal oficial.
                </p>
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-[680px] text-center text-[13.5px] leading-[1.6] text-dark-neutral-400">
              O PearChat respeita o pedido de saída: quem pedir para não receber mais mensagens deixa de receber, e os disparos seguem as regras do WhatsApp.
            </p>
          </div>
        </section>

        {/* Perguntas */}
        <section id="perguntas" aria-labelledby="t-faq" className="py-16 min-[800px]:py-20">
          <div className={`${wrap} max-w-[800px]`}>
            <SectionHead id="t-faq" eyebrow="Perguntas frequentes" title="Tire suas dúvidas" />
            <div className="flex flex-col gap-3">
              {FAQ.map((f) => (
                <details key={f.p} className="group rounded-lg border border-light-divider bg-light-surface open:shadow-md">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-5 py-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                    {f.p}
                    <CaretDown size={16} className="flex-none text-light-neutral-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                  </summary>
                  <p className="px-5 pb-5 text-[14px] leading-[1.65] text-light-neutral-300">{f.r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Chamada final */}
        <section aria-labelledby="t-final" className="pb-16">
          <div className={wrap}>
            <div className="rounded-xl border border-light-accent-700 bg-light-accent-900 px-6 py-12 text-center">
              <h2 id="t-final" className="text-balance text-[26px] font-medium leading-[1.15] tracking-[-0.02em] min-[800px]:text-[32px]">
                Comece a atender melhor hoje
              </h2>
              <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-[1.6] text-light-neutral-300">Crie a sua conta, conecte o WhatsApp e ligue o agente em poucos minutos.</p>
              <Link href="/registro" className={`${ctaPrimary} mt-6`}>
                Criar conta grátis <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-light-divider bg-light-surface py-10">
        <div className={`${wrap} flex flex-col gap-8 min-[800px]:flex-row min-[800px]:justify-between`}>
          <div className="max-w-[420px]">
            <LogoLink />
            <p className="mt-3 text-[12.5px] leading-[1.7] text-light-neutral-400">
              {EMPRESA.razao}
              <br />
              CNPJ {EMPRESA.cnpj}
              <br />
              {EMPRESA.endereco}
            </p>
          </div>
          <nav aria-label="Rodapé" className="flex flex-col gap-2 text-[13.5px]">
            <Link href="/privacidade" className="text-light-neutral-300 underline-offset-2 hover:text-light-text hover:underline">Política de privacidade</Link>
            <Link href="/termos" className="text-light-neutral-300 underline-offset-2 hover:text-light-text hover:underline">Termos de uso</Link>
            <a href={`mailto:${EMPRESA.email}`} className="text-light-neutral-300 underline-offset-2 hover:text-light-text hover:underline">{EMPRESA.email}</a>
            <Link href="/login" className="text-light-neutral-300 underline-offset-2 hover:text-light-text hover:underline">Entrar</Link>
          </nav>
        </div>
        <p className={`${wrap} mt-8 text-[12px] text-light-neutral-400`}>© {new Date().getFullYear()} PearChat</p>
      </footer>
    </div>
  )
}
