# Checklist antes de enviar a Análise do App

Marque cada item no painel da Meta (developers.facebook.com → app PearChat) e no servidor antes de clicar em enviar.
Itens marcados com (?) dependem da tela exata do painel no dia: confira o texto na própria tela.

## 1. Empresa e acesso
- [ ] Verificação da empresa (BM Infodreamz) **aprovada** (hoje: em análise). A Análise do App e o status de Provedor de
      Tecnologia dependem disso.
- [ ] Programa **Provedor de Tecnologia** concluído; **Verificação de acesso** (access verification) feita, se o painel pedir (?).
- [ ] Dados do negócio iguais aos documentos: razão social INFODREAMZ NEGOCIOS DIGITAIS LTDA, CNPJ, endereço, telefone, e-mail,
      site https://pearchat.online (o rodapé do site mostra a razão social e o CNPJ).
- [ ] Contato do app e e-mail de suporte válidos (caixa que você lê).

## 2. Configurações básicas do app
- [ ] Ícone 1024x1024, nome "PearChat", categoria (Negócios e páginas).
- [ ] URL da política de privacidade: https://pearchat.online/privacidade (abre sem login).
- [ ] URL dos termos: https://pearchat.online/termos (abre sem login).
- [ ] **Exclusão de dados**: URL de instruções ou callback de exclusão preenchido (o painel exige para Login do Facebook) (?).
      Pode apontar para a seção de exclusão da política de privacidade.
- [ ] Domínios do app: pearchat.online.
- [ ] Modo do app: **Ativo** (Live) quando enviar; em desenvolvimento só quem tem função no app consegue conectar.

## 3. Login do Facebook para Empresas
- [ ] SDK JS ligado; domínios permitidos: `https://pearchat.online`.
- [ ] URI de redirecionamento válida: `https://pearchat.online/`.
- [ ] Configuração `META_CONFIG_ID` (variação WhatsApp Embedded Signup, produtos Cloud API + Marketing Messages, token de
      usuário do sistema, tarefas de ativo completas) salva e copiada para `META_CONFIG_ID` e `NEXT_PUBLIC_META_CONFIG_ID`.
- [ ] Cadastro incorporado v4, informações de sessão versão 3 (já o padrão do código: `sessionInfoVersion` 3).

## 4. WhatsApp → Configuração (webhook)
- [ ] URL de retorno: `https://pearchat.online/api/wa/meta`.
- [ ] Token de verificação igual a `META_VERIFY_TOKEN` do servidor. O botão "Verificar e salvar" só passa com o servidor
      já no ar com as variáveis novas.
- [ ] Campos assinados: `messages`, `message_template_status_update`, `account_update`, `smb_message_echoes`, `history`,
      `smb_app_state_sync` (os três últimos só valem para Coexistence). Opcionais: `message_template_quality_update`.
- [ ] `META_APP_SECRET` no servidor é o do MESMO app (a assinatura `X-Hub-Signature-256` depende dele).

## 5. Permissões pedidas
- [ ] `whatsapp_business_messaging` e `whatsapp_business_management` com o texto de `permissoes.md`.
- [ ] Não peça permissões que o app não usa (a Meta nega o pacote inteiro).
- [ ] Os dois vídeos (`roteiro-video.md`) anexados, um por permissão.

## 6. Conta de revisor (o revisor precisa conseguir testar)
- [ ] Crie uma conta no PearChat só para o revisor (e-mail e senha fortes) e coloque no campo de instruções.
- [ ] Inclua o e-mail dessa conta em `META_OFICIAL_BETA_EMAILS` **ou** ligue `META_OFICIAL_BETA=true`. Sem isso o revisor
      vê "Em breve" e reprova.
- [ ] Um negócio de teste e um número de teste (ou o número de teste da Meta) já preparados; instruções no campo de notas.
- [ ] Modelo APROVADO pronto na conta de teste (para o passo "janela fechada").
- [ ] Servidor estável durante a análise (a revisão pode levar dias; não faça deploy que mude o fluxo).

## 7. Servidor
- [ ] Variáveis: `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION=v25.0`,
      `META_SIGNUP_MODE`, `META_OFICIAL_BETA*` (ver `teste-do-dono.md`).
- [ ] Migration 0014 aplicada (o deploy roda `migrate deploy`).
- [ ] `https://pearchat.online/api/health` responde 200.
- [ ] Teste completo do `teste-do-dono.md` feito com o seu número ANTES de enviar.

## 8. Cobrança (informar ao cliente, não à Meta)
- [ ] Orientação no onboarding: cadastrar forma de pagamento no Meta Business. Sem pagamento, depois das 1.000 mensagens de
      atendimento grátis por número/mês a Meta deixa de entregar as respostas.
