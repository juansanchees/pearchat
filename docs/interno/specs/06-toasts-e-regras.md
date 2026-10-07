# 06 - Toasts e regras de estado

Toda chamada é `notify(titulo, texto, icone)`; ícone padrão `ph-check-circle`; renderizado com classe `ph-fill`. Duração 3800 ms, 1 toast por vez (novo substitui o anterior). Estilo em 00 seção 7. Formato abaixo: `Título` / `Texto` (ícone).

## 1. Toasts por ação

### Conexão do WhatsApp
- Continuar com a Meta, número com menos de 10 dígitos: `Número incompleto` / `Digite o número com DDD` (`ph-warning`)
- Continuar com a Meta, válido: `Mensagem enviada` / `Abra o WhatsApp Business no celular` (`ph-device-mobile`)
- Concluir conexão oficial: `WhatsApp oficial conectado` / `Importando conversas dos últimos 6 meses` se `ofHist`, senão `{ofNumero}` (`ph-seal-check`)
- Abrir Meta Business: `Meta Business` / `Abriria a página de pagamentos da Meta` (`ph-credit-card`)
- Leitura do QR rápido concluída (após 1700 ms): `WhatsApp conectado` / `Doce Ateliê · +55 11 98765-4321` (`ph-whatsapp-logo`)
- Desconectar (sidebar ou Configurações): `WhatsApp desconectado` / `As automações foram desligadas` (`ph-plugs`)
- Tentar ligar automação bloqueada (cadeado): `Conecte o WhatsApp primeiro` / `Depois disso você pode ligar {Agentes de IA | Disparos automáticos | Follow-up automático}` (`ph-lock-simple`)

### Automações (switches)
- IA desligar: `Agente de IA desligado` / `Novas conversas ficam com você` (`ph-pause-circle`)
- IA ligar sem pendentes: `Agente de IA ligado` / `{nome} vai responder as próximas conversas` (`ph-sparkle`)
- IA ligar com pendentes: `Agente de IA ligado` / `{nome} está respondendo {n} conversas pendentes` (`ph-sparkle`)
- IA terminou a última pendente: `{nome} respondeu {n} conversas` / `Você pode assumir qualquer uma a qualquer momento` (`ph-sparkle`)
- Disparos ligar: `Disparos ativados` / `Campanhas agendadas serão enviadas` (`ph-paper-plane-tilt`)
- Disparos desligar: `Disparos pausados` / `Nenhuma campanha será enviada` (`ph-pause-circle`)
- Follow-up ligar: `Follow-up ligado` / `{fuFila.length} contatos na fila de retomada` (`ph-clock-clockwise`)
- Follow-up desligar: `Follow-up desligado` / `Nenhuma retomada será enviada` (`ph-pause-circle`)

### Conversas
- Assumir conversa (botão): `Você assumiu a conversa` / `{nome agente} pausou para {nome contato}` (`ph-hand`)
- Enviar mensagem numa conversa com a IA atendendo: mesmo toast acima (`ph-hand`)
- Devolver para IA: `Conversa devolvida` / `{nome agente} volta a responder {nome contato}` (`ph-sparkle`)

### Disparos
- Importar lista: `Importar lista` / `Envie um arquivo CSV com nome e telefone` (`ph-upload-simple`)
- Modelo em análise clicado: `Modelo em análise` / `Aguarde a aprovação da Meta para usar` (`ph-clock`)
- Criar modelo: `Modelo enviado para a Meta` / `{id} · em análise` (`ph-clock`)
- Agendar disparo: `Disparo agendado` / `{lista} · {dd/mm, HH:MM}` (`ph-calendar-check`)
- Iniciar disparo: `Disparo iniciado` / `{qtd} contatos · {lista}` (`ph-paper-plane-tilt`)
- Disparo terminou: `Disparo concluído` / `Todas as mensagens foram enviadas` (`ph-check-circle`)

### Drawers genéricos
- Salvar: `Configurações salvas` / `{título do drawer}` (`ph-check-circle`)
- Foto de perfil carregada: `Foto atualizada` / `Seu perfil já mostra a nova foto` (`ph-camera`)

### Plano
- Mudar de plano: `Plano alterado para {nome}` / `A diferença aparece na próxima fatura` (`ph-crown-simple`)
- Trocar cartão: `Trocar cartão` / `Você será levado ao checkout seguro` (`ph-credit-card`)
- Baixar fatura: `Fatura baixada` / `PDF salvo em Downloads` (`ph-download-simple`)

### Agenda
- Outras semanas (setas): `Outras semanas` / `Nesta demonstração só a semana atual tem dados` (`ph-calendar`)
- "Usar outra conta": `Outra conta` / `Abriria a janela de login do Google` (`ph-google-logo`)
- Concluir conexão Google: `Google Agenda conectado` / `{gConta}` (`ph-calendar-check`)
- Desconectar Google: `Google Agenda desconectado` / `Os agendamentos param de sincronizar` (`ph-plugs`)
- IA agenda ligar: `IA pode agendar` / `{nome agente} oferece horários livres aos clientes` (`ph-calendar-check`)
- IA agenda desligar: `IA não agenda mais` / `Só você marca horários` (`ph-calendar-check`)
- Agendar sem horário: `Escolha um horário` / `Toque em um dos horários livres` (`ph-clock`)
- Agendamento criado: `Agendamento criado` / `{cliente ou "Cliente sem nome"} · {curto, ex. sáb, 3/10}, {HH:MM} · enviado ao Google Agenda` (`ph-calendar-check`)

### Contatos
- Carregar mais: `Carregar mais` / `Na versão real a lista continua rolando` (`ph-list`)
- Importar: `Importar contatos` / `Envie um CSV ou sincronize a agenda do celular` (`ph-upload-simple`)
- Exportar: `Exportação pronta` / `{total pt-BR} contatos em CSV` (`ph-download-simple`)
- Salvar sem nome: `Falta o nome` / `Digite o nome do contato` (`ph-warning`)
- Contato salvo: `Contato salvo na nuvem` / `{nome}` (`ph-cloud-check`)
- Conversar sem WhatsApp: `Conecte o WhatsApp primeiro` / `Depois disso você conversa direto daqui` (`ph-lock-simple`)
- Conversar com contato sem chat: `Nova conversa` / `Abrindo conversa com {nome}` (`ph-whatsapp-logo`)

Sem toast (silenciosos): enviar com campo vazio; adicionar par pergunta/resposta incompleto; iniciar disparo com mensagem vazia; remover item da base; Testar com campo vazio; ligar/desligar switch do drawer Agenda sem Google; clique no anexo.

## 2. Regras do README conferidas com o código

| Regra (README) | Código real | Status |
|---|---|---|
| Sem WhatsApp, automações bloqueadas mas drawers abrem | Correto: linha abre drawer, switch vira cadeado, faixa "Bloqueado" | OK |
| Ao desconectar, IA e Follow-up desligam | `iaOn=false`, `fuOn=false`; **`dispOn` não é alterado** (continua true, só aparece bloqueado; ao reconectar, Disparos volta ligado) | Divergência parcial |
| Agenda e Contatos funcionam sem WhatsApp; "Conversar" pede conexão | Correto (toast `Conecte o WhatsApp primeiro`) | OK |
| Modo `null/'ia'/'humano'`; IA só responde `null` ou `'ia'` | Filtro de pendentes: `mode !== 'humano'`, com `unread>0` e resposta em `REPLIES` | OK |
| Assumir ou **mensagem do usuário** muda para humano | Enviar só muda para `'humano'` se `iaOn` verdadeiro; com IA desligada o modo não muda | Divergência |
| Devolver muda para `'ia'` | Correto; botão só com `iaOn && humano`; não dispara resposta | OK |
| Passagem da IA para o usuário por regra, aviso ao cliente e notificação | Só existe na caixa "Testar o agente" (2 regras: desconto e atendente). Nas conversas nunca muda para humano sozinha; sem notificação; "Reclamação" e "Pedido acima de R$ 500" não são avaliadas | Não implementado |
| "Quando responder" (horário) | Salvo em `agente.horario`, não usado | Não implementado |
| IA agenda com `origem:'IA'` | Não há IA criando eventos; só criação manual (`origem:'Manual'`) | Não implementado |
| Lembretes por job | Só chips de seleção, sem efeito | Não implementado |
| Disparos: fila com intervalo aleatório, opt-out, parar ao pausar | Simulação por `setInterval` de 450 ms (ignora o intervalo escolhido); pausa congela o envio; sem opt-out; agendadas nunca executam | Simulado |
| Desligar switch de Disparos pausa campanhas | Correto, mas a sidebar continua mostrando `Enviando · x/y` (checa "enviando" antes de "pausado") | OK com ressalva |
| Follow-up: job, cancela quando responde | Apenas UI; fila estática | Não implementado |
| Medidor: "cada resposta enviada soma 1" | Soma 1 por mensagem enviada pelo **usuário** com `provider==='oficial'`; respostas da IA não somam | Divergência |
| Evento Google `#6bb39a` | Código: `#5fa7a0` | Divergência |
| `top = (hora − 8) × 52`, `altura = duração × 52 − 4` | Código: `top = round((hora − 8) × 52 + 2)`; altura `round(dur × 52 − 4)` | Divergência (+2px) |
| `--radius-lg` 12px | CSS Nocturne: 14px | Divergência |
| "Selo ✦" e rótulo "✦ Luna · IA" | HTML usa ícone Phosphor `ph-sparkle` (ph-fill), não o caractere | Equivalente visual |
| Placeholder "Escreva para assumir a conversa" quando IA atende | Correto; senão `Digite uma mensagem` | OK |
| Toast some em 3,8 s | 3800 ms | OK |
| Conexão rápida: QR renova a cada ~20 s | Não existe; e "O código expira em 2 minutos" é texto estático | Não implementado |
| Trocar tipo de conexão "em Configurações" | Configurações só tem `Desconectar` (que zera `provider`) | Divergência |
| Ao ligar IA: "digitando" ~1 s, intervalo 1,2 s | Typing em `500 + i*1200` ms, resposta em `1500 + i*1200` ms | OK |
| Barra de Agenda: botão "IA pode agendar" só com Google | Correto (`gOn`) | OK |
| Botão "Concluir conexão" Google | Não exige nenhuma agenda marcada | Observação |
| Contatos: nome obrigatório; salvos no topo | Correto; telefone vazio vira `—` | OK |
| Notas do contato "salvas automaticamente" | Gravadas a cada mudança no estado | OK |
| Cartão Agenda mostra "N hoje · próximo HH:MM" | "próximo" é o mais cedo do dia, não relativo à hora atual | Observação |
| Etiqueta/contagens de contatos | Filtros com contagens fixas (312/540/38) que não acompanham os dados listados | Observação |

## 3. Timers e durações (resumo)

| Item | Valor |
|---|---|
| Toast | 3800 ms |
| Leitura QR rápida | 1700 ms |
| Leitura QR oficial | 1500 ms |
| Escolha de conta Google ("Conectando com o Google…") | 1200 ms |
| IA: typing / resposta por pendente i | `500 + i*1200` / `1500 + i*1200` ms |
| Disparo: tick | 450 ms; passo `max(1, ceil(total/22))`; respostas `floor(enviadas*0.09)` |
| Timers de `later()` | só limpos ao desmontar (não ao trocar de tela/tipo) |
