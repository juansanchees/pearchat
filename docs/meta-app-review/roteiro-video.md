# Roteiro dos vídeos da Análise do App

A Meta pede um screencast por permissão. Grave em 1920x1080 (ou 1280x720), idioma da interface em português, com a barra
de endereço visível (https://pearchat.online) e **sem mostrar segredos**: feche abas com o painel de desenvolvedores, não
abra o arquivo de variáveis e não mostre tokens. Narração ou legendas em inglês ajudam o revisor (a tela fica em português).
Mantenha cada vídeo abaixo de 3 minutos. Use a conta de revisor e o número de teste descritos em `checklist.md`.

Antes de gravar: confirme `META_OFICIAL_BETA_EMAILS` com o e-mail da conta de revisor (ou `META_OFICIAL_BETA=true`),
deixe um segundo celular com WhatsApp pronto para falar com o número de teste, e um modelo já APROVADO na conta.

---

## Vídeo 1: enviar e receber mensagem pelo app (whatsapp_business_messaging) — 2 min 30 s

| Tempo | Cena | O que aparece na tela |
|---|---|---|
| 0:00 a 0:10 | Abertura | Tela de login de https://pearchat.online com a barra de endereço. Legenda: "PearChat: customer inbox for WhatsApp Business." |
| 0:10 a 0:40 | Conexão | Entrar na conta de revisor. Menu **WhatsApp** → cartão **WhatsApp Business oficial** → **Continuar com a Meta**. Mostrar o cadastro da Meta abrindo (escolher o negócio e o número de teste), fechar e ver "Número conectado" → **Concluir conexão**. |
| 0:40 a 1:00 | Receber | Mostrar o celular (ou o WhatsApp Web) enviando "Olá, quero um horário" ao número conectado. Voltar ao PearChat: a conversa aparece em **Conversas** com a mensagem. Legenda: "Webhook `messages`." |
| 1:00 a 1:30 | Responder | Abrir a conversa, escrever "Olá! Temos horário amanhã às 14h." e clicar **Enviar**. Mostrar no celular a mensagem chegando e, no PearChat, o status passar para entregue/lida. |
| 1:30 a 1:50 | Mídia | Clipe de papel → escolher uma imagem → **Enviar**. Mostrar a imagem no celular. |
| 1:50 a 2:20 | Janela de 24 h | Abrir uma conversa cuja última mensagem do cliente tem mais de 24 h. Mostrar o aviso âmbar "Janela de 24 h encerrada: envie um modelo aprovado", escolher o modelo aprovado, preencher a variável e clicar **Enviar modelo**. Mostrar a chegada no celular. |
| 2:20 a 2:30 | Fechamento | Voltar à lista de conversas. Legenda: "Free text only inside 24 h; templates outside." |

## Vídeo 2: criar e gerenciar modelo (whatsapp_business_management) — 2 min

| Tempo | Cena | O que aparece na tela |
|---|---|---|
| 0:00 a 0:10 | Abertura | PearChat conectado, barra de endereço visível. Legenda: "Template management." |
| 0:10 a 0:25 | Abrir o painel | Menu lateral → **Disparos automáticos**. Rolar até **Modelo aprovado**: mostrar a lista com os status (Aprovado, Em análise, Rejeitado com motivo). |
| 0:25 a 1:05 | Criar | **Criar modelo** → categoria **Utilidade** → texto `Olá {{1}}, seu pedido {{2}} foi confirmado com sucesso.` → botão `{{2}}` para inserir a segunda variável → exemplos `Ana` e `A-123` → **Enviar para a Meta**. Mostrar o aviso "Modelo enviado para a Meta" e o modelo na lista como "Em análise". Legenda: "POST /message_templates". |
| 1:05 a 1:25 | Sincronizar | Clicar **Atualizar status**. Mostrar o status vindo da Meta (se já aprovado: "Aprovado"). Legenda: "GET /message_templates and `message_template_status_update` webhook." |
| 1:25 a 1:40 | Sugeridos | Mostrar os cartões **Sugerido** (`lembrete_agendamento`, `retomada_conversa`) com **Criar na Meta**: não são criados sozinhos. |
| 1:40 a 1:55 | Usar | Selecionar um modelo **Aprovado** e mostrar a prévia; escolher a lista e abrir o agendamento (sem iniciar). Legenda: "Campaigns only use APPROVED templates." |
| 1:55 a 2:00 | Excluir | Clicar **Excluir** em um modelo de teste e confirmar. Mostrar que ele sai da lista. Legenda: "DELETE /message_templates." |

Dicas: use a mesma conta e número nos dois vídeos; mostre sempre o resultado no celular; não demore em telas de carregamento
(corte); se a Meta pedir senha do Facebook durante a gravação, pause e retome depois do login.
