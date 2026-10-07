# PearChat — Roadmap v2 (decisões de arquitetura do orquestrador)

Regra de design para TODAS as etapas: nenhum componente visual novo. Reaproveitar bolhas, pílulas,
cartões, drawers (540px), medidores, etiquetas e toasts existentes, com os mesmos tokens
(`light-*`, `dark-*`, raios 8/12/999, Inter, títulos peso 500, ícones Phosphor). Textos em pt-BR.
Specs do design: `.claude/tmp/specs/*.md`. Protótipos: `design_handoff_pearchat/` e `design login/`.

Regras de ambiente (valem para todo agente):
- O `.env` aponta para o banco de PRODUÇÃO (schema `pearchat`), lido também pelo motor em produção.
  Testes SEMPRE em schema isolado (`pearchat_test_<x>`), `WA_MOCK=true`, porta própria,
  `connection_limit=2`. Nunca tocar em `pearchat` nem `public`. Nada de `migrate dev/reset`,
  `db push`, `DROP`, `TRUNCATE`.
- Migrations: só aditivas, escritas à mão, numeradas em sequência, aplicadas com `migrate deploy`.
  A migration é aplicada em produção pelo deploy (`remote.sh` roda `migrate deploy`), NÃO pelo agente:
  o agente aplica só no schema de teste. (Mudança de regra: antes os agentes aplicavam direto.)
- Sem `npm install` sem autorização explícita no prompt; sem prettier; sem commit; sem build local
  enquanto houver outro agente rodando.

## Etapa 1 — Mídia e áudio
- Armazenamento: disco local atrás de uma interface `MediaStore` (`src/server/media/store.ts`),
  diretório `MEDIA_DIR` (produção: volume Docker `pearchat_media` montado em `/data/media`;
  dev: `.media/`). Caminho `workspaceId/aaaa-mm/<cuid>.<ext>`. Implementação trocável por S3 depois.
- Modelo: `Message.mediaType` (image|audio|video|document|sticker), `mediaMime`, `mediaSize`,
  `mediaName`, `mediaKey` (chave no MediaStore), `mediaDurationSec`, `transcript`, `transcriptStatus`.
  `mediaUrl` existente passa a ser derivado.
- Servir: `GET /api/media/[messageId]` — sessão obrigatória, confere workspace, `Content-Disposition`
  seguro, `X-Content-Type-Options: nosniff`, suporte a Range para áudio/vídeo. Nunca URL pública.
- Receber (Evolution): baixar com `POST /chat/getBase64FromMediaMessage/{instance}`; limite 25 MB;
  tipos permitidos por lista; falha no download não perde a mensagem (fica o rótulo `[Imagem]`).
- Enviar: `POST /api/conversations/[id]/media` (multipart, 16 MB, lista de MIME permitidos,
  validação por assinatura do arquivo), Evolution `sendMedia`/`sendWhatsAppAudio`; mock grava e "entrega".
- Transcrição: OpenAI `/v1/audio/transcriptions` (modelo configurável `AI_TRANSCRIBE_MODEL`,
  descobrir quais a chave acessa); áudio até 5 min; resultado em `Message.transcript`;
  a IA responde usando a transcrição. Imagem: enviar à IA como entrada de visão só se o modelo
  aceitar; senão responder pedindo texto. Contar uso em `UsageCounter`.
- UI: mesma bolha. Imagem = miniatura (abre em tamanho real numa sobreposição simples),
  áudio = `<audio>` compacto + transcrição em texto menor, documento = linha com ícone e nome.
  Botão de anexo do composer passa a funcionar (prévia antes de enviar).

## Etapa 2 — IA agendando + confirmação de presença
- Function calling no `generateReply`: ferramentas `listar_servicos`, `listar_horarios_livres(data, servico)`,
  `criar_agendamento(servico, inicio, nome)`, `cancelar_agendamento`, `remarcar_agendamento`.
  Só ativas com `AiAgent.canSchedule` e agenda conectada. Laço de no máx. 4 chamadas de ferramenta.
  Sempre confirmar com o cliente antes de criar. Evento com `origem: IA`, vai para o Google.
- Confirmação: `Event.confirmacao` (pendente|confirmado|cancelado_pelo_cliente), lembrete pede
  "1 para confirmar, 2 para remarcar"; resposta do cliente é interpretada pelo motor (regra simples
  + IA quando ligada). Cancelado libera o horário e avisa o usuário (toast/evento socket).

## Etapa 3 — Respostas rápidas + foto de perfil
- `QuickReply { workspaceId, atalho, texto }`; `/` no composer abre lista filtrável; gestão numa
  seção do drawer de Configurações. Variáveis `{primeiro_nome}`.
- Foto: upload pelo MediaStore (`avatars/`), 2 MB, imagem recortada no cliente em quadrado.

## Etapa 4 — Link público de agendamento
- `Workspace.slug` (único), página pública `/a/[slug]` sem login, no visual das telas de acesso:
  escolher serviço → dia → horário → nome e WhatsApp → confirmar. Cria Contact + Event (origem Manual,
  etiqueta "Link"), envia confirmação pelo WhatsApp se conectado. Anti-abuso: limite por IP e por
  telefone, sem expor agenda (só horários livres), honeypot. Ativável nas Preferências da Agenda.

## Etapa 5 — Painel de resultados
- Item "Resultados" em Conta → drawer. Período 7/30/90 dias. Conversas atendidas, tempo médio da
  1ª resposta, % resolvido pela IA sem passagem, passagens, agendamentos (por origem), faltas vs
  confirmados, disparos (enviados/respostas), follow-ups que recuperaram conversa. Consultas agregadas
  com índices; sem biblioteca de gráficos (barras em CSS, como o drawer de Plano).

## Etapa 6 — Pagamentos e limites
- Gateway: Asaas (assinatura recorrente, Pix e cartão). Depende de conta do dono.
- Webhook assinado, `Subscription`/`Invoice`, bloqueio suave ao estourar limite do plano
  (IA para de responder com aviso ao dono; disparos recusam), período de teste de 7 dias.

## Etapa 0 (ANTES da Etapa 1) — Vários WhatsApps por empresa + menu do número + API oficial
Pedido do dono em 03/10. Fundacional: mexe em sessão, conversas, provedores e motor; por isso vem antes da mídia.
- Modelo: `WhatsAppSession` deixa de ser único por workspace (vários por empresa; `apelido`, `ordem`,
  `cor`); `Conversation.sessionId` (conversa pertence a um número; o mesmo contato pode ter uma conversa
  por número: unique passa a ser (sessionId, contactId)); `Campaign.sessionId`; instância da Evolution por
  sessão (`pc_<sessionId>`), mantendo compatibilidade com a instância atual `pc_<workspaceId>` do número já
  conectado (não pode cair). Migração de dados: conversas existentes apontam para a sessão existente.
- Limite por plano (Essencial 1, Pro 1, Negócios 3 — confirmar com o dono).
- UI (sem componente novo): no menu lateral, um cartão de WhatsApp por número, empilhados, e um cartão
  tracejado "+" (mesmo estilo do botão tracejado de bloqueio) para adicionar; clicar num cartão troca o
  número ativo e a tela de Conversas mostra só as conversas dele. Na barra superior de Conversas, ao lado
  do título, um menu (três pontos) com: Renomear, Desconectar, Trocar para API oficial / para QR,
  Importar conversas anteriores, Adicionar outro WhatsApp.
- Automações: configuração do agente é da EMPRESA (uma só); liga/desliga de IA e Follow-up por NÚMERO;
  disparo escolhe o número de envio. (Confirmar com o dono.)
- API oficial (Meta): fluxo Embedded Signup já escrito e nunca testado; exige app da Meta do dono
  (META_APP_ID, META_APP_SECRET, META_CONFIG_ID com Coexistence, verificação da empresa). Webhook
  `https://pearchat.online/api/wa/meta`. Roteia por `metaPhoneNumberId` → sessão.

## Etapa 0 — DECISÃO FINAL DO DONO (substitui o desenho acima da Etapa 0)
Cada WhatsApp é um ESPAÇO totalmente independente: agente de IA próprio (nome, tom, instruções, base),
follow-up próprio, disparos próprios, contatos próprios, agenda própria (inclusive conexão Google e
tipos de atendimento), conversas próprias. "Tudo na mesma tela da empresa": troca-se de WhatsApp pelo
menu lateral e TUDO muda.
Arquitetura escolhida pelo orquestrador (menor risco): cada WhatsApp = um `Workspace` (o isolamento por
`workspaceId` já existe em todas as tabelas e rotas e foi validado no hard test). Acrescentar a camada
`Organization` por cima:
- `Organization { id, nome, plano, statusAssinatura, createdAt }`; `Workspace.organizationId`;
  `User.organizationId`; plano/assinatura/faturas/limites passam a ser da ORGANIZAÇÃO
  (`Workspace.plano` vira legado: ler da organização). Backfill: uma organização por workspace existente.
- `User.workspaceId` passa a significar "espaço ativo". O JWT carrega `organizationId` + `workspaceId`
  ativo; trocar de WhatsApp = `POST /api/spaces/switch` que valida que o workspace é da organização do
  usuário, atualiza `User.workspaceId` e a sessão (update do token), e a interface recarrega os dados
  (socket reconecta na sala nova). NENHUMA rota existente muda de contrato: continuam usando
  `session.workspaceId`.
- Criar espaço: `POST /api/spaces` (limite por plano: Essencial 1, Pro 3, Negócios 5), cria Workspace
  vazio + AiAgent/FollowUpRule padrão + tipos de atendimento genéricos, e leva ao fluxo "Conectar
  WhatsApp". Renomear (`Workspace.nome` = nome do negócio daquele WhatsApp), reordenar, excluir espaço
  (só vazio/desconectado, com confirmação digitando o nome; exclusão real fica para o dono confirmar).
- Uso/limites (respostas de IA, disparos) somam por organização.
- UI: menu lateral lista um cartão de WhatsApp por espaço (nome do negócio, tipo de conexão, número,
  ponto de status) + cartão tracejado "+ Adicionar WhatsApp"; o ativo fica destacado. Barra superior de
  Conversas ganha o menu de três pontos (Renomear, Desconectar, Trocar para API oficial/QR, Importar
  conversas anteriores). Configurações: perfil é do usuário; "Empresa" passa a ser "Este WhatsApp"
  (nome do negócio, horário). Plano e pagamento: da organização, com "N de M WhatsApps".
- Instância da Evolution continua `pc_<workspaceId>` (nada muda para o número já conectado).
- Cuidados: motor de automações já itera por workspace (ok); webhooks roteiam por instância/phoneNumberId
  → workspace (ok); notificações de passagem de IA em espaço NÃO ativo devem aparecer mesmo assim
  (contador/aviso no cartão do outro WhatsApp) — socket entra nas salas de todos os espaços da
  organização só para eventos de aviso (handoff, não lidas), e na sala do ativo para o resto.

## Meta (API oficial) — estado em 03/10/2026
- BM "BM Infodreamz" (INFODREAMZ NEGOCIOS DIGITAIS LTDA), verificação da empresa EM ANÁLISE (identidade do diretor enviada).
- App "PearChat": ID 1786291232598338 (segredo no .env e deploy/.env.production; META_VERIFY_TOKEN gerado no deploy/.env.production).
- Caso de uso "Conectar-se com clientes pelo WhatsApp" ativado; Login do Facebook para Empresas configurado
  (JS SDK ligado, domínio https://pearchat.online). Graph API mostrada pelo painel: v25.0 (código usa v23.0: atualizar).
- WABA de teste: 2120737805987231; número de teste +1 555 636 3598, Phone Number ID 1414370481751066.
- META_CONFIG_ID ainda NÃO existe: a variação "Cadastro incorporado do WhatsApp" só aparece depois de
  "Torne-se um Provedor de Tecnologia" (exige empresa verificada). O painel menciona "Cadastro incorporado
  hospedado pela Meta" (hosted Embedded Signup) — avaliar ao implementar.
- Webhook a configurar no painel (Etapa 2 / Verifique webhooks): https://pearchat.online/api/wa/meta, token = META_VERIFY_TOKEN,
  campo `messages`. Só depois de publicar o servidor com as chaves.
- META_CONFIG_ID = 1624401332810447 (configuração 'PearChat WhatsApp', variação Cadastro incorporado, produtos Cloud API + Marketing Messages, token de usuário do sistema, 7 tarefas). Programa: Independent Tech Provider iniciado. Embedded Signup v4, sessionInfoVersion 3. Link hospedado: https://business.facebook.com/messaging/whatsapp/onboard/?app_id=1786291232598338&config_id=1624401332810447&extras=...

## Fila definida com o dono em 04/10 (ordem de despacho)
1 mídia e áudio (rodando) · 2 link público + resultados (worktree, rodando) · 3 IA agendando + confirmação de presença ·
4 conexão oficial da Meta (envio, recebimento, modelos, webhook, cadastro incorporado v4/hospedado) · 5 respostas rápidas + foto de perfil ·
6 equipe (convites, papéis, atribuição de conversa) · 7 pagamentos e limites (Asaas, modo de teste até o dono criar a conta) ·
8 página inicial do site · 9 segurança e operação (limite de login, 2FA, backup, monitoramento) · 10 hard test final.
FORA por decisão do dono: funil de clientes; aplicativo de celular / PWA / notificações push (acesso 100% via web).
Pendências de deploy: acrescentar ao remote.sh a limpeza de sobras de build (docker image prune -f; docker builder prune -f --filter until=24h).
Zapfloo: apagado da VPS pelo dono em 04/10 (disco 23G/96G). Tabelas antigas continuam no schema public do Supabase.
