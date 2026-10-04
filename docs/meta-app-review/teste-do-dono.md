# Como o dono testa a conexão oficial em produção

Enquanto a verificação da empresa e a Análise do App não terminam, só quem tem função no app da Meta consegue conectar.
O PearChat também esconde a opção dos clientes (beta fechado): só os e-mails da lista veem "Conectar oficial".

## 1. Variáveis no servidor (produção)

Edite o arquivo de variáveis de produção (o mesmo que o deploy usa; `deploy/gen-env.mjs` preserva estas chaves) e reinicie o app.

| Variável | Valor |
|---|---|
| `META_APP_ID` / `NEXT_PUBLIC_META_APP_ID` | 1786291232598338 |
| `META_APP_SECRET` | segredo do app (painel → Configurações do app → Básico) |
| `META_CONFIG_ID` / `NEXT_PUBLIC_META_CONFIG_ID` | 1624401332810447 |
| `META_VERIFY_TOKEN` | o texto que você colocar também no painel do webhook |
| `META_GRAPH_VERSION` | `v25.0` |
| `META_SIGNUP_MODE` | `sdk` (popup do Facebook; cai sozinho para o link hospedado se o SDK não carregar) ou `hosted` |
| `META_OFICIAL_BETA` | `false` (só os e-mails abaixo veem a conexão oficial) |
| `META_OFICIAL_BETA_EMAILS` | `j.dslsanches@gmail.com` (lista separada por vírgula; o e-mail da SUA conta no PearChat) |
| `META_SYSTEM_USER_TOKEN` | só para `META_SIGNUP_MODE=hosted` e para o script do número de teste (item 5) |
| `META_FEATURE_TYPE` | vazio. Se o popup não oferecer a opção de continuar usando o app WhatsApp Business, tente `whatsapp_business_app_onboarding` |

As variáveis `NEXT_PUBLIC_*` são lidas em tempo de execução para decidir o que cada usuário vê; não precisa refazer o build só
por elas, mas reinicie o container.

## 2. Webhook no painel da Meta

Painel → seu app → **WhatsApp → Configuração** (ou "Webhooks"):

- **URL de retorno:** `https://pearchat.online/api/wa/meta`
- **Token de verificação:** o valor de `META_VERIFY_TOKEN`
- Clique em **Verificar e salvar** (o servidor já precisa estar no ar com as variáveis).
- Em **Campos do webhook**, assine: `messages`, `message_template_status_update`, `account_update`, `smb_message_echoes`,
  `history`, `smb_app_state_sync`.

O que esperar: ao verificar, o painel confirma. Se der "não foi possível validar", confira o token (diferença de maiúscula) e se o
app reiniciou com as variáveis. O app responde 403 ao token errado e 401 a mensagens com assinatura inválida.

## 3. Teste com o SEU número (Coexistence)

Pré-requisitos: o número está no app **WhatsApp Business** (versão 2.24.17 ou mais nova, segundo a documentação da Meta) e
você tem função de administrador no app da Meta.

1. Entre no PearChat com o e-mail da lista. Em **WhatsApp**, o cartão "WhatsApp Business oficial" deve estar ativo ("Recomendado").
   Se estiver "Em breve", o e-mail não está em `META_OFICIAL_BETA_EMAILS` ou o container não foi reiniciado.
2. Clique em **Conectar oficial → Continuar com a Meta**. Abre a janela da Meta: entre, escolha o negócio e o número. A Meta
   mostra um QR code para ler no app WhatsApp Business do celular e pergunta se compartilha o histórico.
3. A janela fecha e a tela mostra "Confirmando com a Meta…" e depois o passo "Trazer suas conversas?". Escolha e clique
   **Concluir conexão**. O número deve aparecer no menu lateral como "Oficial".
4. Mande uma mensagem de outro celular ao número: ela aparece em **Conversas** em poucos segundos.
5. Responda pelo PearChat: chega no celular do cliente. Responda pelo app WhatsApp Business do celular: a mensagem também
   aparece no PearChat e a conversa passa para "Humano".
6. Mande uma imagem (JPEG ou PNG) e um áudio (ogg/opus, mp3, m4a ou aac) pelo PearChat. Formatos que a API oficial não aceita
   (ex.: imagem webp/gif, áudio webm/wav) seguem como documento ou são recusados com aviso.
7. **Disparos automáticos → Modelo aprovado → Criar modelo.** Crie um modelo de utilidade, clique **Atualizar status**
   até virar "Aprovado" (minutos a horas). Também crie os sugeridos `lembrete_agendamento` e `retomada_conversa` (botão
   "Criar na Meta").
8. Teste a janela: numa conversa em que o cliente não escreve há mais de 24 h aparece o aviso âmbar com a escolha do modelo.
9. Cadastre a forma de pagamento no Meta Business (link no último passo da conexão).

Se algo der errado no meio, a tela volta ao início com a mensagem de erro e um novo `state`; é seguro tentar de novo.

## 4. Modo hospedado pela Meta (alternativa)

Com `META_SIGNUP_MODE=hosted` (ou quando o SDK é bloqueado no navegador), o botão abre o link
`business.facebook.com/messaging/whatsapp/onboard/?app_id=…&config_id=…&extras=…` em outra aba. Nesse modo a tela pede o número
do WhatsApp, e a conclusão vem pelo webhook `account_update` (`PARTNER_ADDED`): o PearChat consulta a cada 5 s, ou ao clicar
**Já concluí**, procura o cadastro novo e só liga se o número da conta for o que você digitou. Exige `META_SYSTEM_USER_TOKEN`.

### Criar o token de usuário do sistema (só para o modo hospedado e para o número de teste)

1. business.facebook.com → Configurações do negócio → Usuários → **Usuários do sistema** → **Adicionar** (função Administrador).
2. Atribua ativos: o app PearChat (controle total) e a conta do WhatsApp de teste.
3. **Gerar token**: app PearChat, validade "Nunca" (se disponível), permissões `whatsapp_business_management` e
   `whatsapp_business_messaging`. Copie uma vez (a Meta não mostra de novo) e guarde em `META_SYSTEM_USER_TOKEN`.
4. No SDK normal (Cadastro incorporado) NÃO precisa deste token: cada cliente gera o próprio token no cadastro.

## 5. Teste com o número de teste da Meta (sem Cadastro incorporado)

O número de teste (WABA 2120737805987231, Phone Number ID 1414370481751066) vive no seu Business Manager. Para ligá-lo a um workspace do
PearChat, com `META_SYSTEM_USER_TOKEN` configurado, rode no servidor:

```
docker compose exec app npx tsx scripts/meta-link-number.ts j.dslsanches@gmail.com 2120737805987231 1414370481751066
```

O script confere que o número é da WABA, assina o app nos webhooks e marca a sessão como conectada. O número de teste só envia
para até 5 destinatários cadastrados no painel (WhatsApp → Introdução → "Para"). Mensagens a outros números falham com o
erro 131030.

## 6. Diagnóstico de erros pelo `fbtrace_id`

Toda falha da Graph API vira uma linha nos logs do app com `status`, `code`, `subcode` e `fbtrace_id`, sem token nem texto de
mensagem: `docker compose logs app | grep -i "fbtrace_id"`. A mensagem que falhou fica gravada com o motivo e o código
(`Message.failReason`). O `fbtrace_id` serve para abrir chamado na Meta.

| Código | Significado | O que fazer |
|---|---|---|
| 190 / 401 | token inválido ou expirado | O PearChat marca o número com erro e desliga as automações. Reconecte o WhatsApp. |
| 131047 | passaram 24 h desde a última mensagem do cliente | Envie um modelo aprovado (aviso âmbar acima do campo de mensagem). |
| 131030 | número fora da lista de destinatários (conta de teste) | Cadastre o destinatário no painel da Meta. |
| 131042 | forma de pagamento | Cadastre pagamento no Meta Business. |
| 131026 | mensagem não entregue (número sem WhatsApp, versão antiga) | Nada a fazer; confira o número. |
| 131049 | a Meta segurou a mensagem para proteger a qualidade | Reduza campanhas de marketing; espere. |
| 132000 / 132012 | variáveis não batem com o modelo | Recrie o modelo com exemplos corretos. |
| 132001 | modelo inexistente ou não aprovado | **Atualizar status**; use só "Aprovado". |
| 133010 | número não registrado na Cloud API | O PearChat tenta registrar sozinho uma vez; se persistir, reconecte. |
| 100 com `subcode` 33 | token sem acesso à WABA/número | Refaça o cadastro escolhendo os ativos corretos. |
| 368 / restrição | conta restringida | Veja o Gerenciador do WhatsApp; o PearChat desliga as automações. |

Problemas do cadastro:

- **Popup não abre / "Esta tentativa expirou":** desbloqueie pop-ups e clique de novo (cada tentativa tem um código novo).
- **"A Meta recusou o código":** o código vale 30 s. Se a troca falhar de novo, veja nos logs
  `[wa/embedded-signup] code recusado (… subcode=… fbtrace_id=…)`. Erro de `redirect_uri`: o servidor já tenta sem, com vazio e com
  `https://pearchat.online/`; se ainda falhar, confira a URI de redirecionamento no Login do Facebook para Empresas.
- **"Esse número já está conectado a outro workspace":** o número só pode estar em um workspace; desconecte o outro primeiro.
- **Webhook 401 nos logs da Meta:** `META_APP_SECRET` diferente do app que envia.
- **Mensagens não chegam:** confira se o campo `messages` está assinado, se a WABA foi assinada (`subscribed_apps`) e se o
  número da conversa é o `metaPhoneNumberId` da sessão.
