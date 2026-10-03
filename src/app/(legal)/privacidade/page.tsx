// ATENÇÃO: este texto foi redigido como base a partir do que o produto faz hoje e DEVE ser revisado por advogado
// antes de ser tratado como definitivo. Atualize a data em src/components/legal/legal-layout.tsx a cada mudança.
import type { Metadata } from 'next'
import { A, EMPRESA, LegalLayout, Mail, P, UL, type LegalSection } from '@/components/legal/legal-layout'

export const metadata: Metadata = {
  title: 'Política de Privacidade · PearChat',
  description: 'Como o PearChat trata dados pessoais, conforme a LGPD: quais dados, para quê, com quem compartilhamos e como exercer seus direitos.',
}

const secoes: LegalSection[] = [
  {
    id: 'quem-somos',
    titulo: 'Quem somos e papéis no tratamento',
    corpo: (
      <>
        <P>
          O PearChat é uma plataforma para atender clientes pelo WhatsApp, com agente de IA, disparos, follow-up e agenda, oferecida por {EMPRESA.razao}, CNPJ {EMPRESA.cnpj}, com sede em {EMPRESA.endereco}.
        </P>
        <P>Para a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018), atuamos em dois papéis:</P>
        <UL>
          <li><strong>Controlador</strong> dos dados de cadastro das pessoas que usam a plataforma (você, usuário), como nome, e-mail e senha.</li>
          <li><strong>Operador</strong> dos dados dos clientes finais do seu negócio (contatos e conversas de WhatsApp). Nesse caso, o negócio que usa o PearChat é o controlador e nós tratamos os dados conforme as instruções dele e estes termos.</li>
        </UL>
        <P>Contato do encarregado pelo tratamento de dados pessoais (DPO): <Mail />.</P>
      </>
    ),
  },
  {
    id: 'dados',
    titulo: 'Quais dados coletamos',
    corpo: (
      <>
        <UL>
          <li><strong>Cadastro:</strong> nome, e-mail e senha (guardada somente em formato de hash, nunca em texto aberto).</li>
          <li><strong>Empresa:</strong> nome do negócio, horário de atendimento, plano e configurações do agente de IA (nome, tom de voz, instruções e base de conhecimento que você escreve).</li>
          <li><strong>Contatos e conversas do WhatsApp do seu negócio:</strong> nome e número dos contatos, mensagens enviadas e recebidas, estado das conversas, modelos de mensagem e campanhas.</li>
          <li><strong>Agenda:</strong> compromissos criados no PearChat e, se você conectar o Google Agenda, os eventos das agendas que você autorizar (veja a seção “Uso de dados do Google”).</li>
          <li><strong>Uso do serviço:</strong> registros técnicos necessários para o funcionamento e a segurança (por exemplo, contadores de uso do plano, datas de acesso e registros de erro).</li>
        </UL>
        <P>O número de WhatsApp pedido no formulário de criação de conta ainda não é armazenado.</P>
      </>
    ),
  },
  {
    id: 'finalidades',
    titulo: 'Para que usamos e bases legais',
    corpo: (
      <UL>
        <li>Criar e manter sua conta, autenticar o acesso e prestar o serviço contratado. Base: execução de contrato (art. 7º, V).</li>
        <li>Conectar o WhatsApp do negócio, exibir conversas, enviar mensagens e disparos, executar follow-up e a agenda. Base: execução de contrato; para os dados dos clientes finais, tratamos como operador, sob as instruções do negócio (que responde pela base legal aplicável).</li>
        <li>Gerar respostas do agente de IA a partir das conversas. Base: execução de contrato e instrução do negócio controlador.</li>
        <li>Segurança, prevenção a fraudes e abuso, e cumprimento de obrigações legais. Base: legítimo interesse (art. 7º, IX) e obrigação legal (art. 7º, II).</li>
        <li>Comunicações sobre a conta, suporte e avisos do serviço. Base: execução de contrato e legítimo interesse.</li>
      </UL>
    ),
  },
  {
    id: 'compartilhamento',
    titulo: 'Com quem compartilhamos',
    corpo: (
      <>
        <P>Não vendemos dados pessoais. Compartilhamos apenas com prestadores necessários para operar o serviço (operadores e suboperadores):</P>
        <UL>
          <li><strong>Supabase:</strong> banco de dados, hospedado nos Estados Unidos.</li>
          <li><strong>Hostinger:</strong> hospedagem do servidor da aplicação, no Brasil.</li>
          <li><strong>Meta / WhatsApp:</strong> transporte das mensagens pelo WhatsApp.</li>
          <li><strong>Evolution API:</strong> software de conexão com o WhatsApp, auto-hospedado por nós (não envia dados a terceiros além do WhatsApp).</li>
          <li><strong>Provedor de IA (OpenAI; podemos usar também a Anthropic):</strong> o conteúdo da conversa e as instruções do agente são enviados ao provedor para gerar a resposta do agente de IA. Só ocorre quando o agente de IA está em uso.</li>
          <li><strong>Google:</strong> Google Agenda, somente se você conectar a sua conta.</li>
        </UL>
        <P>Também podemos divulgar dados quando exigido por lei ou ordem de autoridade competente.</P>
      </>
    ),
  },
  {
    id: 'transferencia',
    titulo: 'Transferência internacional',
    corpo: (
      <P>
        Alguns prestadores (como o Supabase, o provedor de IA e o Google) tratam dados fora do Brasil, inclusive nos Estados Unidos. Nessas hipóteses, a transferência se apoia no art. 33 da LGPD, em especial na execução de contrato e nas garantias contratuais dos próprios prestadores, e buscamos prestadores que adotem medidas de segurança e proteção compatíveis.
      </P>
    ),
  },
  {
    id: 'retencao',
    titulo: 'Retenção e exclusão',
    corpo: (
      <>
        <P>Mantemos os dados enquanto a conta estiver ativa e pelo tempo necessário para cumprir obrigações legais ou exercer direitos em processos. Ao encerrar a conta, os dados da empresa, contatos, conversas e agenda são excluídos, salvo o que a lei nos obrigue a guardar.</P>
        <P>Você pode pedir a exclusão da conta e dos dados pelo e-mail <Mail />. Ao desconectar o Google Agenda, os acessos guardados são removidos.</P>
      </>
    ),
  },
  {
    id: 'seguranca',
    titulo: 'Segurança',
    corpo: (
      <UL>
        <li>Conexão protegida por HTTPS.</li>
        <li>Senhas guardadas somente com hash.</li>
        <li>Credenciais de acesso (como as do WhatsApp e do Google) criptografadas em repouso.</li>
        <li>Isolamento dos dados por empresa: cada conta só acessa os dados do próprio negócio.</li>
      </UL>
    ),
  },
  {
    id: 'direitos',
    titulo: 'Seus direitos',
    corpo: (
      <>
        <P>Nos termos do art. 18 da LGPD, o titular pode solicitar: confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento, revogação do consentimento (quando houver) e eliminação dos dados tratados com consentimento.</P>
        <P>Para exercer seus direitos, escreva para <Mail />. Responderemos no prazo legal. Se você é cliente final de um negócio que usa o PearChat, pedidos sobre suas conversas devem ser feitos primeiro a esse negócio (controlador); podemos ajudar a atendê-los. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</P>
      </>
    ),
  },
  {
    id: 'google',
    titulo: 'Uso de dados do Google',
    corpo: (
      <>
        <P>Se você entrar com o Google, o PearChat recebe o nome, o e-mail e a foto do seu perfil, usados apenas para criar e identificar a sua conta.</P>
        <P>Se você conectar o Google Agenda, o PearChat pede acesso por meio do login do Google (OAuth), com os escopos:</P>
        <UL>
          <li><code>https://www.googleapis.com/auth/calendar.events</code>: ver, criar, atualizar e excluir eventos;</li>
          <li><code>https://www.googleapis.com/auth/calendar.readonly</code>: ler a lista e os dados das suas agendas.</li>
        </UL>
        <P>Usamos esses dados apenas para: mostrar os compromissos na agenda do PearChat; verificar horários livres; e criar, atualizar e excluir os eventos que você mesmo agenda pelo PearChat (inclusive quando você autoriza o agente de IA a agendar).</P>
        <P>Os dados do Google <strong>não são vendidos</strong>, <strong>não são usados para publicidade</strong> e <strong>não são usados para treinar modelos de IA generalizados</strong>. Não os transferimos a terceiros, exceto quando necessário para prestar o serviço que você pediu, para cumprir a lei ou como parte de uma operação societária, com aviso a você. Os acessos (tokens) ficam criptografados em repouso.</P>
        <P>O uso e a transferência, para qualquer outro app, de informações recebidas das APIs do Google seguem a <A href="https://developers.google.com/terms/api-services-user-data-policy">Política de Dados do Usuário dos Serviços de API do Google</A>, incluindo os requisitos de Uso Limitado.</P>
        <P>
          <strong>Como revogar o acesso:</strong> no PearChat, em Agenda → Desconectar; ou diretamente na sua conta Google, em <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>.
        </P>
      </>
    ),
  },
  {
    id: 'cookies',
    titulo: 'Cookies',
    corpo: <P>Usamos apenas cookies essenciais, necessários para manter a sua sessão de login e proteger o acesso. Não usamos cookies de publicidade nem de rastreamento de terceiros.</P>,
  },
  {
    id: 'criancas',
    titulo: 'Crianças e adolescentes',
    corpo: <P>O PearChat é destinado a empresas e profissionais maiores de 18 anos e não é direcionado a crianças e adolescentes. Se tomarmos conhecimento de cadastro de menor sem a autorização legal, excluiremos a conta. Os negócios que atendem menores pelo WhatsApp respondem por tratar esses dados conforme o art. 14 da LGPD.</P>,
  },
  {
    id: 'alteracoes',
    titulo: 'Alterações desta política',
    corpo: <P>Podemos atualizar esta política para refletir mudanças no serviço ou na lei. A data de “Última atualização” fica no topo e no rodapé; em mudanças relevantes, avisaremos por e-mail ou dentro do app.</P>,
  },
]

export default function PrivacidadePage() {
  return (
    <LegalLayout
      titulo="Política de Privacidade"
      intro="Este documento explica, em linguagem direta, como o PearChat trata dados pessoais em conformidade com a LGPD."
      secoes={secoes}
      outra={{ href: '/termos', label: 'Termos de Uso' }}
    />
  )
}
