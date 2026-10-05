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
          <li><strong>Provedor de IA (OpenAI; podemos usar também a Anthropic):</strong> o conteúdo da conversa e as instruções do agente são enviados ao provedor para gerar a resposta do agente de IA. Só ocorre quando o agente de IA está em uso. Se você ligar “IA pode agendar”, o provedor também recebe os horários livres calculados a partir da sua agenda (por exemplo, 14:00 e 16:00), nunca títulos nem detalhes de eventos do Google.</li>
          <li><strong>Google:</strong> Google Agenda, somente se você conectar a sua conta (detalhes na seção “Uso de dados do Google”).</li>
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
        <P>Você pode pedir a exclusão da conta e dos dados pelo e-mail <Mail />. Ao desconectar o Google Agenda, o acesso é revogado no Google e os acessos guardados são removidos (veja “Uso de dados do Google”).</P>
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
        <P>
          Esta seção explica, de forma específica, como o PearChat acessa, usa, guarda e compartilha as informações que recebe das APIs do Google. Há dois usos separados: entrar com o Google e conectar o Google Agenda. O segundo é opcional.
        </P>
        <P>
          <strong>Entrar com o Google.</strong> Se você entrar com o Google, o PearChat recebe o nome, o e-mail e a foto do seu perfil (escopos <code>openid</code>, <code>email</code> e <code>profile</code>), usados apenas para criar e identificar a sua conta.
        </P>
        <P>
          <strong>Permissões do Google Agenda.</strong> Se você conectar o Google Agenda, o PearChat pede acesso por meio do login do Google (OAuth). A tela do Google mostra cada permissão e deixa você desmarcar; sem as três a conexão não é feita. Os escopos pedidos são:
        </P>
        <UL>
          <li><code className="break-all">https://www.googleapis.com/auth/calendar.events</code>: ver, criar, alterar e excluir eventos das suas agendas. Usamos para mostrar na Agenda do PearChat os eventos das agendas que você escolher e para criar, atualizar e remover, no seu Google Agenda, os agendamentos feitos pelo PearChat. Só alteramos ou apagamos eventos que o próprio PearChat criou.</li>
          <li><code className="break-all">https://www.googleapis.com/auth/calendar.calendarlist.readonly</code>: ver a lista das suas agendas, somente leitura. Usamos para você escolher quais agendas o PearChat considera.</li>
          <li><code className="break-all">https://www.googleapis.com/auth/calendar.freebusy</code>: ver apenas os intervalos em que você está ocupado ou livre, sem título nem detalhes. Usamos para oferecer só horários livres.</li>
        </UL>
        <P><strong>O que lemos do Google Agenda:</strong></P>
        <UL>
          <li>A lista das suas agendas: nome, cor, se é a principal e o seu nível de acesso (dono, editor ou leitor).</li>
          <li>Os horários ocupados (início e fim) das agendas que você marcar.</li>
          <li>Os eventos das agendas que você marcar, somente do período que está na tela: título, início, fim, se dura o dia todo e se você recusou o convite (eventos recusados ou cancelados não aparecem). Se o evento tiver outros campos, como descrição, local ou lista de participantes, o PearChat os ignora na hora e não os grava.</li>
          <li>As mudanças dos eventos que o PearChat criou: a cada cerca de 2 minutos o PearChat consulta as mudanças da agenda onde criou eventos, só para saber se você moveu ou apagou um deles e manter o agendamento igual. As demais mudanças são ignoradas e não são gravadas.</li>
        </UL>
        <P><strong>O que enviamos ao Google:</strong> ao criar ou atualizar um agendamento, o PearChat envia o título (normalmente o nome do serviço), o horário e, na descrição, o nome e o telefone do cliente informados pelo seu negócio, mais a frase “Criado pelo PearChat”. Esses dados passam a ficar na sua agenda do Google.</P>
        <P><strong>O que guardamos e por quanto tempo:</strong></P>
        <UL>
          <li>Enquanto o Google Agenda estiver conectado: os acessos (tokens), criptografados em repouso com AES-256-GCM; a lista de agendas (nome, cor, nível de acesso, quais você marcou e em qual os novos agendamentos são criados); o e-mail da conta Google conectada; e marcadores técnicos de sincronização. Tudo isso é apagado quando você desconecta.</li>
          <li>Os identificadores dos eventos que o PearChat criou no Google, para atualizá-los ou removê-los depois. O vínculo é removido quando você desconecta.</li>
          <li>Não gravamos no nosso banco de dados os eventos que você já tinha no Google. Eles são buscados na hora para aparecer na tela e ficam apenas na memória do servidor por até 45 segundos.</li>
          <li>Os agendamentos feitos no PearChat (serviço, horário, nome e telefone do cliente) são registros do seu negócio no PearChat e seguem a seção “Retenção e exclusão”, mesmo que você desconecte o Google.</li>
        </UL>
        <P><strong>O que a IA recebe:</strong> se você ligar a opção “IA pode agendar”, o provedor de IA recebe apenas os horários livres que o PearChat calcula (por exemplo, 14:00 e 16:00), para o agente oferecer ao cliente. Ele nunca recebe títulos, descrições, participantes nem qualquer outro detalhe dos eventos do seu Google Agenda, nem a lista das suas agendas.</P>
        <P><strong>Quem pode ver:</strong> nenhuma pessoa da equipe do PearChat lê os seus dados do Google Agenda, exceto com a sua autorização expressa (por exemplo, num pedido de suporte), quando for necessário para investigar abuso ou segurança, ou para cumprir a lei. Como não gravamos os eventos que vêm do Google, não há esse conteúdo para consultar no nosso banco. As pessoas do seu próprio espaço que têm acesso à Agenda no PearChat veem os eventos na tela, como você.</P>
        <P><strong>Com quem compartilhamos:</strong> os dados do Google <strong>não são vendidos</strong>, <strong>não são usados para publicidade</strong> (inclusive personalizada) e <strong>não são usados para treinar modelos de IA ou de aprendizado de máquina generalizados</strong>. Só os transferimos a terceiros quando necessário para prestar o serviço que você pediu: aos prestadores de infraestrutura que operam o PearChat (banco de dados e servidor, listados na seção “Com quem compartilhamos”) e ao provedor de IA, nos termos acima. Também podemos transferi-los para cumprir a lei ou numa operação societária (fusão ou aquisição), com aviso a você.</P>
        <P><strong>Desconectar, revogar e excluir:</strong></P>
        <UL>
          <li><strong>Desconectar no PearChat</strong> (Agenda, Preferências, botão Desconectar): o PearChat pede ao Google que revogue o acesso e apaga os tokens, a lista de agendas, os marcadores de sincronização e o vínculo com os eventos. Se o Google estiver fora do ar nesse momento, o pedido de revogação pode falhar; mesmo assim apagamos tudo do nosso lado, e você pode revogar direto no Google. Os eventos que o PearChat já criou continuam na sua agenda do Google, e os agendamentos continuam no PearChat.</li>
          <li><strong>Revogar pelo Google:</strong> em <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>. Quando o PearChat percebe a revogação (na renovação seguinte do acesso), deixa de usar o Google para essa conta e pede que você reconecte ou desconecte.</li>
          <li><strong>Encerrar a conta</strong> (pedido pelo e-mail <Mail />): a conexão com o Google Agenda e tudo o que ela guarda é excluída do nosso banco. Para o Google também encerrar o acesso, desconecte o Google Agenda no PearChat antes de pedir o encerramento, ou revogue pelo link acima.</li>
        </UL>
        <P><strong>Uso Limitado.</strong> O uso e a transferência, para qualquer outro app, de informações recebidas das APIs do Google seguem a <A href="https://developers.google.com/terms/api-services-user-data-policy">Política de Dados do Usuário dos Serviços de API do Google</A>, incluindo os requisitos de Uso Limitado. Usamos os dados do Google Agenda apenas para oferecer as funções de agenda descritas acima.</P>
        <P>
          <em lang="en">PearChat&apos;s use and transfer to any other app of information received from Google APIs will adhere to <A href="https://developers.google.com/terms/api-services-user-data-policy#limited-use">Google API Services User Data Policy</A>, including the Limited Use requirements.</em>
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
