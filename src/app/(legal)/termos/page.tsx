// ATENÇÃO: este texto foi redigido como base a partir do que o produto faz hoje e DEVE ser revisado por advogado
// antes de ser tratado como definitivo. Atualize a data em src/components/legal/legal-layout.tsx a cada mudança.
import type { Metadata } from 'next'
import Link from 'next/link'
import { EMPRESA, LegalLayout, Mail, P, UL, type LegalSection } from '@/components/legal/legal-layout'

export const metadata: Metadata = {
  title: 'Termos de Uso · PearChat',
  description: 'Regras de uso do PearChat: conta, planos, uso aceitável do WhatsApp, responsabilidades e foro.',
}

const priv = (
  <Link href="/privacidade" className="text-light-accent-200 underline underline-offset-2">Política de Privacidade</Link>
)

const secoes: LegalSection[] = [
  {
    id: 'objeto',
    titulo: 'Objeto',
    corpo: <P>Estes Termos regulam o uso do PearChat, plataforma de atendimento pelo WhatsApp com agente de IA, disparos, follow-up e agenda, oferecida por {EMPRESA.razao}, CNPJ {EMPRESA.cnpj} (“PearChat”, “nós”). Ao criar uma conta ou usar o serviço, você declara que leu e aceita estes Termos e a {priv}.</P>,
  },
  {
    id: 'cadastro',
    titulo: 'Cadastro e conta',
    corpo: (
      <UL>
        <li>Você deve ter 18 anos ou mais e poder contratar em nome do negócio que representa.</li>
        <li>Informe dados verdadeiros e mantenha-os atualizados.</li>
        <li>Você é responsável por guardar a sua senha e por toda atividade feita na sua conta. Avise-nos se suspeitar de acesso indevido.</li>
        <li>Uma conta pertence a uma empresa; o acesso a ela não deve ser compartilhado fora do seu negócio.</li>
      </UL>
    ),
  },
  {
    id: 'planos',
    titulo: 'Planos e pagamento',
    corpo: (
      <>
        <P>O PearChat é oferecido em planos (Essencial, Pro e Negócios), com os valores e limites exibidos no app. Os limites de cada plano (por exemplo, respostas de IA, disparos e contatos) podem ser aplicados ao uso da conta.</P>
        <P>Quando houver cobrança, ela seguirá o plano contratado e os valores informados no app no momento da contratação. Avisaremos com antecedência razoável antes de iniciar a cobrança ou de alterar preços, e você poderá cancelar antes disso.</P>
      </>
    ),
  },
  {
    id: 'uso-aceitavel',
    titulo: 'Uso aceitável',
    corpo: (
      <>
        <P>Você se compromete a usar o PearChat de forma lícita e, em especial:</P>
        <UL>
          <li>não enviar spam nem mensagens em massa a quem não as solicitou ou não tem relação com o seu negócio;</li>
          <li>respeitar o pedido de quem não quer mais receber mensagens (opt-out) e parar de contatá-lo;</li>
          <li>cumprir os <strong>termos e as políticas do WhatsApp/Meta</strong> aplicáveis, inclusive a política da Meta sobre uso de IA e assistentes automatizados em suas plataformas;</li>
          <li>não enviar conteúdo ilegal, fraudulento, ofensivo ou que viole direitos de terceiros;</li>
          <li>não tentar burlar limites, invadir, sobrecarregar ou fazer engenharia reversa do serviço.</li>
        </UL>
        <P><strong>Conexão não oficial.</strong> A conexão por QR code usa um software que não é a API oficial do WhatsApp. Seu uso é por conta e risco do usuário: o WhatsApp pode restringir ou banir números, especialmente em disparos em massa, e não nos responsabilizamos por esses bloqueios.</P>
        <P>Podemos suspender contas que violem estas regras, com aviso quando possível.</P>
      </>
    ),
  },
  {
    id: 'dados-clientes',
    titulo: 'Dados dos seus clientes',
    corpo: (
      <>
        <P>Os contatos e as conversas que você conecta ao PearChat são dados dos seus clientes. Você, como controlador desses dados, é responsável por ter base legal para tratá-los e para enviá-los ao PearChat, por informar seus clientes (inclusive sobre o atendimento por IA, se for o caso) e por atender os pedidos deles. Nós tratamos esses dados como operador, conforme a {priv}.</P>
        <P>Você é responsável pelas instruções e pela base de conhecimento que dá ao agente de IA e por revisar as respostas dele. Respostas geradas por IA podem conter erros.</P>
      </>
    ),
  },
  {
    id: 'disponibilidade',
    titulo: 'Disponibilidade e suporte',
    corpo: <P>Trabalhamos para manter o serviço disponível, mas ele depende de terceiros (WhatsApp, hospedagem, provedor de IA, Google) e pode ter interrupções, manutenções e mudanças, sem garantia de funcionamento ininterrupto. O suporte é prestado por e-mail, em <Mail />.</P>,
  },
  {
    id: 'propriedade',
    titulo: 'Propriedade intelectual',
    corpo: <P>O PearChat, sua marca, interface e código pertencem a {EMPRESA.razao}. Concedemos a você uma licença limitada, não exclusiva e intransferível para usar o serviço enquanto a conta estiver ativa. O conteúdo que você insere (contatos, mensagens, instruções) continua sendo seu, e você nos autoriza a tratá-lo apenas para prestar o serviço.</P>,
  },
  {
    id: 'responsabilidade',
    titulo: 'Limitação de responsabilidade',
    corpo: <P>Na extensão permitida pela lei, o serviço é fornecido “no estado em que se encontra” e não respondemos por lucros cessantes, perda de oportunidades, bloqueios de número pelo WhatsApp, falhas de terceiros ou respostas inadequadas do agente de IA. Nossa responsabilidade total por danos diretos fica limitada ao valor pago por você nos 12 meses anteriores ao fato. Nada aqui afasta direitos que a lei não permite limitar, como os do Código de Defesa do Consumidor, quando aplicáveis.</P>,
  },
  {
    id: 'rescisao',
    titulo: 'Rescisão',
    corpo: <P>Você pode encerrar a conta a qualquer momento, pedindo pelo e-mail <Mail />. Podemos suspender ou encerrar contas que violem estes Termos ou a lei. Após o encerramento, os dados serão tratados conforme a seção de retenção e exclusão da {priv}.</P>,
  },
  {
    id: 'alteracoes',
    titulo: 'Alterações',
    corpo: <P>Podemos atualizar estes Termos. A data de “Última atualização” fica no topo e no rodapé; em mudanças relevantes, avisaremos por e-mail ou no app. Continuar usando o serviço após o aviso significa aceitar a nova versão.</P>,
  },
  {
    id: 'foro',
    titulo: 'Lei aplicável e foro',
    corpo: <P>Estes Termos são regidos pelas leis do Brasil. Fica eleito o foro da {EMPRESA.foro}, com renúncia a qualquer outro, ressalvado o foro do domicílio do consumidor quando a lei assim determinar.</P>,
  },
]

export default function TermosPage() {
  return (
    <LegalLayout
      titulo="Termos de Uso"
      intro="Leia com atenção: estas são as regras para usar o PearChat."
      secoes={secoes}
      outra={{ href: '/privacidade', label: 'Política de Privacidade' }}
    />
  )
}
