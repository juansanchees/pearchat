# Análise do App (Meta): texto das permissões

Textos prontos para colar nos campos "Como seu app usa esta permissão" da Análise do App. Primeiro em inglês (é o que o
revisor lê), depois em português (para você conferir). Os passos de reprodução assumem a conta de revisor descrita em
`checklist.md`.

Dados do app: **PearChat**, ID 1786291232598338. Site: https://pearchat.online. Empresa: INFODREAMZ NEGOCIOS DIGITAIS LTDA.
Política de privacidade: https://pearchat.online/privacidade. Termos: https://pearchat.online/termos.

---

## English

### Overview (paste in the app description / notes to the reviewer)

PearChat is a web-based customer service platform for small businesses in Brazil. A business connects its WhatsApp number
through Meta's Embedded Signup, then uses PearChat to answer its customers in a shared inbox, to let an AI assistant answer
questions about the business and book appointments, to send appointment reminders, and to send campaigns with approved
message templates. We are a Tech Provider: each business connects its own WhatsApp Business Account and we only act on
the accounts that the business explicitly shares with us. We never send messages to people who did not contact the
business or opt in, and we honor opt-out requests ("stop") automatically.

### whatsapp_business_messaging

How PearChat uses it:

1. **Receive messages.** Customers write to the business number. Meta delivers the message to our webhook
   (`/api/wa/meta`, `messages` field). PearChat shows it in the business's inbox ("Conversas") with delivery status updates
   (sent, delivered, read, failed).
2. **Reply inside the 24-hour customer service window.** A team member (or the business's AI assistant, which only talks
   about that business) answers through `POST /{phone-number-id}/messages` with text, images, audio, video or documents
   (media uploaded with `POST /{phone-number-id}/media`).
3. **Reply outside the window with approved templates only.** When the 24-hour window is closed, PearChat blocks free text
   and shows a banner: "Janela de 24 h encerrada: envie um modelo aprovado". The user can only pick an APPROVED template.
4. **Campaigns and reminders.** Campaigns (to contacts of the business that did not opt out) and appointment reminders are
   sent only with APPROVED templates, with a random interval between sends and a quiet-hours setting.
5. **Opt-out.** If the customer writes "stop" (or similar), the contact is flagged and excluded from every campaign.

Why we need it: without this permission a business cannot send or receive customer messages in PearChat.

### whatsapp_business_management

How PearChat uses it:

1. **Onboarding.** After Embedded Signup, we exchange the code for the business token, read the business's phone numbers
   (`GET /{waba-id}/phone_numbers`) to confirm the number belongs to the WABA, and subscribe our app to the WABA's webhooks
   (`POST /{waba-id}/subscribed_apps`). We also read the display number, verified name and quality rating of the number.
2. **Message templates.** In the "Disparos" panel the business creates a template
   (`POST /{waba-id}/message_templates`, with the required example for each variable), lists templates and their status
   (`GET /{waba-id}/message_templates`), and deletes templates (`DELETE /{waba-id}/message_templates`). We also receive
   `message_template_status_update` webhooks to show APPROVED, PENDING, REJECTED (with the reason), PAUSED or DISABLED.
3. **Account health.** `account_update` webhooks tell us when the business removed the partner or the account was
   restricted; PearChat then marks the number as disconnected and turns automations off.

Why we need it: the business needs to create and manage its own templates and connect its own WABA without leaving PearChat.

### Step-by-step for the reviewer

Use the reviewer account from the submission notes (login at https://pearchat.online/login). The WhatsApp official
connection is enabled for this account.

1. Log in. In the left menu open **WhatsApp**. Choose **WhatsApp Business oficial** ("Conectar oficial"), then
   **Continuar com a Meta**. Complete Meta's Embedded Signup with the test business and test number provided. When it
   closes, PearChat shows the connected number. Click **Concluir conexão**.
2. **Receive:** from another phone, send "Hello" to the connected number. The message appears in **Conversas** within seconds.
3. **Send (inside the window):** open the conversation, type a reply and press **Enviar**. The message is delivered to the
   phone and the status changes to delivered/read.
4. **Send media:** click the paperclip, choose an image and send it.
5. **Templates (management permission):** in the left menu open **Disparos automáticos**. In **Modelo aprovado** click
   **Criar modelo**, write `Olá {{1}}, seu pedido {{2}} foi confirmado com sucesso.`, fill the examples (`Ana`, `A-123`)
   and click **Enviar para a Meta**. The template appears as "Em análise". Click **Atualizar status** to sync; when Meta
   approves it, it appears as "Aprovado". The trash icon deletes it on Meta.
6. **Outside the window:** open a conversation whose last customer message is older than 24 hours (or wait 24 hours). The
   banner "Janela de 24 h encerrada: envie um modelo aprovado" appears above the message box; choose the approved template,
   fill the variables and click **Enviar modelo**.

Data handling: message content is stored only in the business's own PearChat workspace, encrypted at rest at the provider
level; access tokens are encrypted (AES-256-GCM) in our database; we do not sell or share data. Users can delete their
data from the account settings or by writing to the contact in the privacy policy.

---

## Português

### Visão geral

O PearChat é uma plataforma web de atendimento para pequenos negócios. A empresa conecta o próprio número pelo Cadastro
incorporado da Meta e usa o PearChat para responder clientes numa caixa de entrada compartilhada, deixar um assistente de
IA responder sobre o negócio e marcar horários, enviar lembretes e fazer campanhas com modelos aprovados. Somos Provedor de
Tecnologia: cada empresa conecta a própria conta do WhatsApp Business e só agimos nas contas que ela compartilha conosco.
Nunca enviamos mensagem a quem não falou com a empresa ou não deu consentimento, e o pedido de saída ("parar") é respeitado
automaticamente.

### whatsapp_business_messaging

1. **Receber mensagens** pelo webhook `/api/wa/meta` (campo `messages`), mostradas em **Conversas** com o status de entrega.
2. **Responder dentro da janela de 24 h** com texto e mídia (`POST /{phone-number-id}/messages` e `/media`), por uma pessoa da
   equipe ou pela IA do negócio (restrita ao assunto da empresa).
3. **Responder fora da janela só com modelo aprovado**: o PearChat bloqueia texto livre e mostra o aviso "Janela de 24 h
   encerrada: envie um modelo aprovado".
4. **Campanhas e lembretes** só com modelos APROVADOS, com intervalo entre envios e horário de silêncio.
5. **Saída**: quem escreve "parar" é marcado e sai de todas as campanhas.

### whatsapp_business_management

1. **Conexão**: troca do código pelo token do negócio, leitura dos números da conta (`GET /{waba-id}/phone_numbers`) e
   assinatura do app nos webhooks (`POST /{waba-id}/subscribed_apps`).
2. **Modelos**: criar (`POST /{waba-id}/message_templates`, com exemplo para cada variável), listar com o status
   (`GET`), excluir (`DELETE`) e receber `message_template_status_update` (Aprovado, Em análise, Rejeitado com motivo,
   Pausado, Desativado).
3. **Saúde da conta**: `account_update` avisa se o parceiro foi removido ou se a conta foi restringida; o PearChat marca o
   número como desconectado e desliga as automações.

### Passo a passo do revisor

Igual ao passo a passo em inglês acima (login → WhatsApp → Conectar oficial → Continuar com a Meta → enviar "Olá" de outro
celular → responder → enviar imagem → Disparos → Criar modelo → Atualizar status → janela fechada → Enviar modelo).
