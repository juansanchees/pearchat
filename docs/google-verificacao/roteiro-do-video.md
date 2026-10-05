# Roteiro do vídeo de demonstração (2 a 3 minutos)

O Google só aprova se o vídeo mostrar, no app em produção (https://pearchat.online):
1. o fluxo de login/autorização completo que o usuário vê;
2. a tela de permissão do Google em INGLÊS, mostrando todos os escopos pedidos e o nome do app (PearChat);
3. a barra de endereço do navegador mostrando o ID do cliente OAuth (`client_id=...`);
4. o uso de CADA escopo dentro do app.

Fonte: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification e https://support.google.com/cloud/answer/15549135 (o Google também pede que o vídeo cubra todos os clientes OAuth do projeto).

## Antes de gravar (15 min)

1. O passo 2 do `passo-a-passo.md` (marca) já está publicado e o orquestrador confirmou a lista final de escopos. Se mudar o escopo depois, o vídeo precisa ser regravado.
2. Use o Chrome, janela cheia, zoom 100%. Abra duas abas: PearChat (https://pearchat.online) e Google Agenda (https://calendar.google.com), na MESMA conta.
3. No Google Agenda crie, para AMANHÃ (ou outro dia útil futuro; horários que já passaram não aparecem como livres), 3 compromissos de exemplo: "Reunião de exemplo" 10:00 a 11:00, "Almoço" 12:00 a 13:00 e um de dia inteiro "Feriado de exemplo". Sem dados pessoais reais.
4. No PearChat, deixe o Google Agenda DESCONECTADO (Agenda → Preferências → Desconectar, se estiver conectado). Tenha pelo menos 1 tipo de atendimento cadastrado. Use o nome "Cliente Teste"; não mostre conversas nem contatos reais.
5. Windows: ligue "Não perturbe" e feche WhatsApp Web, e-mail e outros programas.
6. Como gravar:
   - Opção A: Win+G abre a Barra de Jogos; botão de gravar (ou Win+Alt+R). Grava só a janela do Chrome, então use sempre ABAS, nunca janela nova. O arquivo vai para Vídeos → Capturas.
   - Opção B: Ferramenta de Captura (Win+Shift+S) → ícone de câmera de vídeo → selecione a janela inteira do Chrome, com a barra de endereço.
7. Fale em inglês, devagar, lendo as frases abaixo. Se não quiser falar, avise o orquestrador (ele providencia legendas); vídeo mudo costuma atrasar a análise.
8. Anote os 10 primeiros caracteres do ID do cliente (Console → Clientes) para conferir depois que ele aparece na barra de endereço.

## Cenas

| # | Tempo | O que mostrar | O que dizer (inglês) | Escopo |
|---|---|---|---|---|
| 1 | 0:00 a 0:10 | Abra https://pearchat.online/ (a barra de endereço aparece). Role até o rodapé e passe o mouse em "Política de privacidade". | "This is PearChat, at pearchat.online. It helps small businesses answer customers on WhatsApp and schedule appointments. This video shows how it uses Google Calendar." | |
| 2 | 0:10 a 0:25 | Se estiver logado, saia. Em /login clique "Continuar com Google" e escolha a conta (a tela do Google pode aparecer em português; não tem problema aqui). | "Users can sign in with Google. This only requests basic profile information: name, email and picture." | openid, email, profile |
| 3 | 0:25 a 1:00 | Já logado, abra a aba Agenda (https://pearchat.online/agenda). Clique em "Conectar Google Agenda" e depois no cartão "Google Agenda". Na tela de escolha de conta do Google, clique UMA vez na barra de endereço para mostrar o endereço completo e deixe parado 4 segundos com o `client_id=...` visível (clique fora depois). Escolha a conta. Se aparecer "Google hasn't verified this app", clique "Advanced" → "Go to pearchat.online (unsafe)". Na tela de permissão, role até o canto inferior esquerdo e troque o idioma para "English (United States)". Mostre o nome PearChat, o logo e a lista de permissões inteira; mostre a barra de endereço de novo. Marque tudo e clique "Continue". | "Now the OAuth consent screen, in English. The address bar shows our OAuth client ID. The app is PearChat and it asks for two permissions: view and edit events on my calendars, and see my calendars. I allow both." | calendar.events, calendar.readonly |
| 4 | 1:00 a 1:10 | De volta ao PearChat: tela "Quais agendas o PearChat pode usar?". Mostre a lista de agendas, marque a principal, clique "Concluir conexão". | "PearChat lists my calendars so I choose which ones block time slots. This uses the calendar list permission." | calendar.readonly (calendarList) |
| 5 | 1:10 a 1:30 | A grade semanal mostra os 3 compromissos de exemplo (no dia de amanhã). Passe para a aba do Google Agenda e mostre os mesmos 3. Volte. | "My Google events appear in the PearChat agenda, read-only, so I see one schedule." | calendar.events (leitura) |
| 6 | 1:30 a 2:00 | Painel "Novo agendamento": escolha o dia dos exemplos, mostre que as 10:00 e as 12:00 NÃO aparecem em "Horários livres". Digite "Cliente Teste", escolha um horário livre e clique "Agendar...". Vá à aba do Google Agenda, recarregue (F5) e abra o novo evento, mostrando título e descrição. | "Busy times from Google are not offered. When I book, PearChat creates the event in my Google Calendar, with the customer name in the description." | calendar.readonly (free/busy), calendar.events (criar) |
| 7 | 2:00 a 2:20 | No PearChat, clique no agendamento → altere o horário → "Salvar alterações". Mostre no Google que o evento mudou (F5). Volte, exclua o agendamento e mostre que sumiu do Google (F5). | "Rescheduling updates the same Google event, and deleting removes it. PearChat only changes events it created." | calendar.events (atualizar, apagar) |
| 8 | 2:20 a 2:40 | Preferências → "Link de agendamento" (ligue o interruptor se estiver desligado): mostre o endereço, abra-o numa nova ABA e mostre a página pública (sem agendar). Volte e aponte o botão "IA pode agendar" no topo da Agenda. | "Customers can also book on the public page, and the AI assistant on WhatsApp uses the same functions when the owner turns this switch on." | |
| 9 | 2:40 a 3:05 | Preferências → "Desconectar". Mostre o aviso "Google Agenda desconectado". Abra https://pearchat.online/privacidade#google e mostre o título "Uso de dados do Google". | "The user can disconnect at any time; PearChat revokes the token and deletes the stored credentials. Our privacy policy explains the use of Google data, including the Limited Use requirements." | |

Se passar de 3:30, corte a cena 8. Ao terminar, reconecte o Google Agenda de verdade se quiser continuar usando.

## Conferir antes de subir

Assista ao vídeo inteiro e confirme:
- o `client_id=...` aparece legível na barra de endereço por pelo menos 3 segundos (se na tela de permissão ele não aparecer, ele precisa aparecer na tela de escolha de conta, que vem antes);
- a tela de permissão está em inglês, com o nome PearChat e os dois escopos legíveis;
- não aparece nenhum dado pessoal real (contatos, conversas, senhas, e-mails de terceiros);
- o som está audível.

Depois siga o passo 4 do `passo-a-passo.md` (YouTube, "Não listado").
