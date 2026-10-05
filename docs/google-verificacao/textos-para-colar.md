# Textos para colar no formulário do Google

Os blocos em inglês (dentro das caixas) são o que você cola. A tradução em português logo abaixo é só para você entender o que está enviando; não cole a tradução.
Tudo aqui foi conferido no código do PearChat (`src/server/calendar/**`, `src/app/api/calendar/**`, `src/server/agent/tools.ts`) e vale para a versão com os escopos novos (calendar.events, calendar.calendarlist.readonly e calendar.freebusy). Se o app mudar, este arquivo precisa mudar junto.

Fontes oficiais do formato exigido:
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification (justificativa por escopo e "por que um escopo menor não basta")
- https://support.google.com/cloud/answer/13464321 (requisitos de verificação e uso limitado)
- Tabelas de escopo por método: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert (e `events/list`, `calendarList/list`, `freebusy/query`)

---

## 1. Descrição do app

```text
PearChat (https://pearchat.online) is a web application for small businesses that talk to their customers on WhatsApp. It provides a shared inbox, an optional AI assistant, automatic follow-up messages, broadcast notices and an appointment calendar called "Agenda".

The business owner can optionally connect their Google Calendar to the Agenda. When connected: (1) the owner's existing Google Calendar events are shown in the Agenda and block those time slots, so customers are never offered a time that is already taken; and (2) appointments booked through PearChat are created, updated and removed in the owner's Google Calendar. Appointments can be booked by the owner or staff in the Agenda, by customers on the business's public booking page, or by the AI assistant in a WhatsApp conversation (only if the owner has turned that option on).

The integration is optional and can be disconnected at any time from the Agenda screen. PearChat uses Google Calendar data only to provide these user-facing features. The app is operated by INFODREAMZ NEGOCIOS DIGITAIS LTDA (Brazil) and its interface is in Brazilian Portuguese.
```

Tradução: O PearChat é um aplicativo web para pequenos negócios que atendem clientes pelo WhatsApp: caixa de entrada compartilhada, assistente de IA opcional, mensagens de follow-up, avisos em massa e uma agenda. O dono pode, se quiser, conectar o Google Agenda. Conectado, (1) os eventos que ele já tem no Google aparecem na Agenda e bloqueiam esses horários, e (2) os agendamentos feitos no PearChat são criados, atualizados e removidos no Google Agenda dele. Agendar pode ser feito pelo dono ou equipe, pelo cliente na página pública de agendamento, ou pela IA numa conversa de WhatsApp (só se o dono ligou essa opção). A integração é opcional e pode ser desconectada a qualquer momento. Os dados do Google só são usados para essas funções. O app é operado pela INFODREAMZ NEGOCIOS DIGITAIS LTDA (Brasil), com interface em português do Brasil.

---

## 2. Escopos e justificativa de cada um (lista final)

O app pede exatamente estes três escopos (está em `src/server/calendar/google.ts`). O Console (Acesso a dados) precisa listar os mesmos três, e só eles, para o Calendar. Quando o Google pedir "scope justification", cole o bloco do escopo correspondente.

| Escopo | Para que serve (em uma frase) |
|---|---|
| `https://www.googleapis.com/auth/calendar.events` | Ver os eventos das agendas marcadas e criar, atualizar e apagar os agendamentos feitos no PearChat |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Ver a lista de agendas da conta (só leitura), para o usuário escolher quais usar |
| `https://www.googleapis.com/auth/calendar.freebusy` | Ver só os horários ocupados/livres (sem título nem detalhes), para oferecer apenas horários livres |

O escopo `calendar.readonly` NÃO é mais pedido. Ele foi trocado pelos dois de baixo, que são mais estreitos (cada um serve a um único método da API). As contas que já estavam conectadas continuam funcionando sem reconectar.

### 2.1. `https://www.googleapis.com/auth/calendar.events`

```text
Scope: https://www.googleapis.com/auth/calendar.events

How PearChat uses it
- Create / update / delete: when an appointment is booked in PearChat (by the owner or staff on the Agenda screen, by a customer on the business's public booking page, or by the AI assistant when the owner has turned on "IA pode agendar"), PearChat creates the matching event in the user's primary Google Calendar. The title is the appointment title (normally the service name) and the description contains the customer's name and phone number as entered by the business, plus "Criado pelo PearChat" ("Created by PearChat"). When the appointment is rescheduled or cancelled in PearChat, the same event is updated or deleted. PearChat only changes or deletes events that it created itself (it keeps their IDs) and never edits other events.
- Read: PearChat reads the events (title, start, end, all-day flag; declined and cancelled events are hidden) of the calendars the user ticked, only for the period shown on screen, and displays them read-only in the Agenda next to the PearChat appointments, so the user sees one schedule and avoids conflicts. About every 2 minutes it also checks the change feed of the calendar where it created events and applies only the changes to the events it created, so that if the user moves or deletes one directly in Google Calendar, the appointment in PearChat is updated to match; all other events are ignored and not stored.

Where the user sees it
Agenda screen (https://pearchat.online/agenda): the weekly grid shows the Google events; the "Novo agendamento" (New appointment) panel creates the event and shows a message that it was sent to Google Agenda; editing or deleting an appointment updates or removes it in Google.

Why a narrower scope is not enough
Creating, changing and deleting events requires one of calendar, calendar.events, calendar.events.owned or calendar.app.created (events.insert / events.patch / events.delete reference). calendar.app.created only covers secondary calendars created by the app itself, so it cannot put appointments in the user's own calendar or read the user's existing events, and reading those events to prevent double-booking is the core of the feature. calendar.events.owned and calendar.events.owned.readonly only cover calendars the user owns, but PearChat lets the user tick any calendar in their calendar list (including calendars shared with them) so that those events also block time and appear in the Agenda. The read-only variants (calendar.events.readonly) cannot create or change events.
```

Tradução: Uso: criar/atualizar/apagar: ao marcar um horário no PearChat (pelo dono/equipe na Agenda, pelo cliente na página pública, ou pela IA quando o dono ligou "IA pode agendar"), o PearChat cria o evento correspondente na agenda principal do Google do usuário (título = nome do serviço; descrição = nome e telefone do cliente informados pelo negócio + "Criado pelo PearChat"). Remarcar ou cancelar no PearChat atualiza ou apaga o mesmo evento. O PearChat só altera ou apaga eventos que ele mesmo criou. Ler: lê os eventos (título, início, fim, dia inteiro; recusados e cancelados ficam ocultos) das agendas marcadas pelo usuário, só do período na tela, e mostra somente leitura na Agenda; a cada ~2 minutos confere o histórico de mudanças da agenda onde criou eventos e aplica só as mudanças nos eventos que ele criou (se o usuário mover/apagar no Google, o PearChat acompanha); os demais eventos são ignorados e não ficam guardados. Onde o usuário vê: tela Agenda. Por que não um escopo menor: `calendar.app.created` só cobre agendas secundárias criadas pelo próprio app (não escreve na agenda real nem lê os compromissos existentes); `calendar.events.owned` só cobre agendas que o usuário é dono, mas ele pode marcar qualquer agenda da lista (inclusive compartilhadas); `calendar.events.readonly` não cria nem altera.

### 2.2. `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

```text
Scope: https://www.googleapis.com/auth/calendar.calendarlist.readonly

How PearChat uses it
Only for calendarList.list. Right after the user grants access, PearChat lists the user's calendars (name, colour, access role) and shows them on the "Quais agendas o PearChat pode usar?" (Which calendars can PearChat use?) screen, so the user chooses which calendars block time slots and appear in the Agenda. The list (IDs, names, colours, selection) is stored so the screen can be shown again.

Where the user sees it
Right after connecting, on the calendar selection screen.

Why a narrower scope is not enough
calendarList.list is the only call we make with this scope, and this is the read-only scope designed for it. We do not need to add or remove calendars, so we do not request calendar.calendarlist, and we do not request the broader calendar.readonly.
```

Tradução: Só para `calendarList.list`: depois que o usuário autoriza, lista as agendas dele (nome, cor, papel) na tela "Quais agendas o PearChat pode usar?"; a lista é guardada para reexibir a tela. É o escopo de leitura feito para isso; não pedimos o `calendar.calendarlist` (que também altera a lista) nem o `calendar.readonly` (mais amplo).

### 2.3. `https://www.googleapis.com/auth/calendar.freebusy`

```text
Scope: https://www.googleapis.com/auth/calendar.freebusy

How PearChat uses it
Only for freeBusy.query. To compute free time slots, PearChat asks Google which time ranges are busy in the calendars the user ticked, and offers only free slots in the Agenda's "New appointment" panel, on the business's public booking page and to the AI assistant. Only busy intervals (start and end) are used; no event details are involved.

Where the user sees it
Agenda > New appointment > "Horários livres" (free times) list; the business's public booking page.

Why a narrower scope is not enough
freeBusy.query is the only call we make with this scope, and it returns availability only. We do not need event contents for this purpose.
```

Tradução: Só para `freeBusy.query`: pergunta ao Google quais intervalos estão ocupados nas agendas marcadas e oferece só horários livres (painel Novo agendamento, página pública, IA). Só usa início e fim dos intervalos; nenhum detalhe de evento.

### 2.4. Se o Google perguntar "por que não `calendar.readonly`?"

```text
We do not request calendar.readonly. The two read-only needs that it would cover are served by narrower scopes, one per API method: calendar.calendarlist.readonly for calendarList.list and calendar.freebusy for freebusy.query. Events are read with calendar.events, which we need anyway to create, update and delete the appointments booked through PearChat.
```

Tradução: Não pedimos `calendar.readonly`: cada necessidade de leitura usa o escopo mais estreito do método correspondente, e os eventos são lidos com `calendar.events`, que já precisamos para criar, atualizar e apagar.

### 2.5. Outras alternativas (descartadas por enquanto; só relato)

Base: tabelas "Authorization" das páginas de referência do Calendar API (`events/list`, `events/insert`, `events/patch`, `events/delete`, `calendarList/list`, `freebusy/query`, conferidas em 05/10/2026).

| Alternativa | O que muda no app | Pró | Contra |
|---|---|---|---|
| `calendar.events.owned` no lugar de `calendar.events` | Só agendas das quais o usuário é dono | Escopo mais estreito | Agendas compartilhadas deixam de bloquear horário; ler eventos continua sendo "sensível" (o Google cita "ler eventos do Calendar" como exemplo de escopo sensível), então a verificação não some |
| `calendar.app.created` no lugar de `calendar.events` (mantendo os dois de leitura) | O PearChat passaria a criar uma agenda secundária própria para os agendamentos e só enxergaria horários ocupados (sem títulos) | Pode eliminar escopos sensíveis, se o Console classificar os três como não sensíveis (não confirmado); sem 100 usuários nem tela de aviso | Muda o produto: agendamentos não vão para a agenda principal, a Agenda do PearChat deixa de mostrar os títulos dos compromissos do usuário, perde a edição de eventos já criados; decisão do dono |

---

## 3. Respostas-padrão a pedidos de esclarecimento

Use só a que o Google perguntar. Responda no próprio e-mail do Google.

### 3.1. Por que precisam desse escopo / existe escopo menor?

```text
Thank you for the review. For each scope we described the exact API methods used, where the user sees the feature in the app, and why narrower scopes do not cover the same use case (see the scope justifications submitted). PearChat is a scheduling and productivity tool: it connects the owner's calendar so that customers are never offered a time that is already taken, and keeps appointments booked through PearChat in sync with Google Calendar. We request only what these features need and nothing for future features. If you believe a specific scope can be replaced by a narrower one without losing a feature, please tell us which one and we will update the app.
```

Tradução: Agradece a análise, lembra que cada escopo foi detalhado (métodos, onde o usuário vê, por que um menor não basta), descreve o app como ferramenta de agendamento/produtividade, diz que só pede o necessário e se compromete a trocar se o Google indicar um escopo menor que mantenha todas as funções.

### 3.2. O PearChat guarda dados do Google? Por quanto tempo?

```text
PearChat stores: (a) the OAuth tokens, encrypted at rest with AES-256-GCM; (b) the user's list of calendars (ID, name, colour, access role and which ones the user ticked) and the email of the connected account; (c) the Google IDs of the events that PearChat itself created (to update or delete them later) and technical sync markers. PearChat does not store the content of the user's other Google Calendar events: they are fetched on demand to be displayed and are held only in server memory for up to 45 seconds. The appointments created in PearChat (service, time, and the customer name and phone entered by the business) are the business's own PearChat records.
When the user clicks "Desconectar" (Disconnect) in the Agenda, PearChat revokes the token with Google and deletes the stored tokens, calendar list and sync markers, and removes the link to the Google events; events already created remain in the user's own Google Calendar. When an account is closed, or on a deletion request sent to j.dslsanches@gmail.com, all the workspace data, including the Google connection record, is deleted.
```

Tradução: Guarda (a) tokens criptografados (AES-256-GCM); (b) lista de agendas (id, nome, cor, papel, quais estão marcadas) e o e-mail da conta conectada; (c) ids dos eventos que o próprio PearChat criou e marcadores de sincronização. Não guarda o conteúdo dos outros eventos do Google (buscados na hora, só em memória até 45 s). Os agendamentos criados no PearChat são registros do próprio negócio. Ao desconectar: revoga o token no Google, apaga tokens, lista e marcadores e o vínculo com os eventos; os eventos já criados ficam na agenda Google do usuário. Ao encerrar a conta ou a pedido por e-mail, apaga tudo.

### 3.3. Compartilham dados do Google com terceiros ou com IA?

```text
PearChat does not sell Google user data, does not use it for advertising and does not transfer it to third parties except as described here. The data is processed only by the infrastructure providers needed to run the service (database hosted by Supabase, application server hosted by Hostinger), as listed in our privacy policy. If the owner has turned on the AI assistant ("IA pode agendar"), the AI provider receives only the available time slots computed from the free/busy information (for example "14:00, 16:00") so the assistant can offer them to a customer; it does not receive event titles or other event details. Google user data is not used to train generalized AI or machine-learning models.
```

Tradução: Não vende nem repassa dados do Google e não usa para publicidade. Só os provedores de infraestrutura processam (banco no Supabase, servidor na Hostinger). Se o dono ligou a IA, o provedor de IA recebe só os horários livres (ex.: 14:00, 16:00), nunca títulos nem detalhes de eventos. Os dados não treinam modelos de IA generalistas.

### 3.4. Pessoas leem os dados do Google?

```text
PearChat staff do not read users' Google Calendar data. Because event details from Google are not stored, there is nothing to browse. Access would happen only with the user's explicit consent (for example, a support request), for security or abuse investigation, or to comply with law, as the Limited Use requirements allow.
```

Tradução: A equipe não lê os dados do Google Agenda dos usuários; como os detalhes não são guardados, não há o que ler. Só com consentimento expresso, por segurança/abuso ou por lei. A política de privacidade (seção "Uso de dados do Google") diz exatamente o mesmo.

### 3.5. Como o usuário revoga o acesso ou apaga os dados?

```text
Users can disconnect at any time in PearChat (Agenda > Preferências > Desconectar), which revokes the token and deletes the stored credentials, or revoke access at https://myaccount.google.com/permissions. If access is revoked from the Google Account, PearChat detects it on the next request, stops all Google calls for that account and asks the user to reconnect or disconnect. Users can also request deletion of their data at j.dslsanches@gmail.com. This is described in our privacy policy: https://pearchat.online/privacidade#google
```

Tradução: Desconectar no PearChat (Agenda, Preferências, Desconectar) revoga o token e apaga as credenciais; ou revogar em myaccount.google.com/permissions (o PearChat percebe, para de chamar o Google e pede reconexão). Pedido de exclusão por e-mail. Descrito na política de privacidade.

### 3.6. O vídeo não mostrou o que precisamos (reenvio)

```text
Hello, thank you for the review. We recorded a new demo video: <YOUTUBE UNLISTED LINK>. It shows: (1) the sign-in flow; (2) the OAuth consent screen in English, with the browser address bar showing our OAuth client ID and the app name PearChat; (3) the exact scopes requested; (4) how each scope is used inside the app (calendar list, free/busy, reading events, creating, updating and deleting events); and (5) how the user disconnects. Please let us know if anything else is needed.
```

Tradução: Avisa que gravou um vídeo novo e lista o que ele mostra (login, tela de permissão em inglês com o ID do cliente na barra de endereço e o nome PearChat, escopos exatos, uso de cada escopo, como desconectar). Troque `<YOUTUBE UNLISTED LINK>` pelo link.

### 3.7. Domínio, página inicial, política de privacidade

```text
Our domain pearchat.online is verified in Google Search Console by the Google Cloud project owner account. Home page: https://pearchat.online/ (public, describes the app, links to the privacy policy and terms in the footer). Privacy policy: https://pearchat.online/privacidade (Google data section: https://pearchat.online/privacidade#google, including the Limited Use statement). Terms: https://pearchat.online/termos. Contact: j.dslsanches@gmail.com.
```

Tradução: Domínio verificado no Search Console pela conta dona do projeto; página inicial pública, com links no rodapé; política de privacidade com seção sobre dados do Google e declaração de Uso Limitado; termos; contato.
