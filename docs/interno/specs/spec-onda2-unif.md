# Etapa UNIF — uma conversa só por cliente, LID × telefone (worktree /home/user/wt-unif, branch onda2-unif, schema de teste `c`, portas 3052–3053)

Leia primeiro `/tmp/pearchat-pg/specs/COMUM.md` e `docs/interno/specs/spec-onda2.md` (seção 3). Esta branch tem 37
erros de `tsc` que são da etapa FUSO (arquivos em `/tmp/pearchat-pg/specs/erros-fuso.txt`): ignore-os, não os corrija,
não introduza outros.

## Problema
Um contato pode existir só com o LID (`Contact.waUserId`, sem telefone; vem do histórico importado ou de mensagem cujo
webhook não trouxe o telefone). Quando a Evolution depois entrega, no MESMO evento, o LID e o telefone
(`key.remoteJid = <lid>@lid` + `key.remoteJidAlt`/`senderPn = <tel>@s.whatsapp.net`; `src/server/whatsapp/normalize.ts`
`jidToRef` já devolve `{ waUserId, telefone }`), `findOrCreateContact` em `src/server/messages/ingest.ts` encontra o
contato pelo LID e tenta gravar o telefone; se o telefone já pertence a OUTRO contato do espaço (criado antes por
telefone), o `P2002` é engolido e ficam DOIS contatos e DUAS conversas do mesmo cliente. O mesmo vale ao contrário
(contato achado pelo telefone, LID já em outro).

## Regra de unificação (decidida pelo orquestrador; não amplie)
Unificar SOMENTE com prova: o mesmo evento traz LID e telefone e eles apontam para dois contatos diferentes do mesmo
espaço (ou o contato achado por um dos dois já tem o outro identificador igual ao do evento). Nunca por nome, foto ou
semelhança. Grupos (`@g.us`) nunca.

Numa TRANSAÇÃO (`db.$transaction`), com proteção contra concorrência (dois webhooks do mesmo cliente ao mesmo tempo:
use `pg_advisory_xact_lock(hashtext(<workspaceId>:<telefone>))` via `$executeRaw` dentro da transação, ou outro
mecanismo equivalente que você justifique; o segundo precisa enxergar o resultado do primeiro e não falhar):
- Mantém o contato mais ANTIGO (`createdAt`); em empate, o que tem telefone. O outro é o "duplicado".
- Conversa: `Conversation.contactId` é único e há no máximo uma conversa por contato. Se os dois têm conversa, mantém a
  conversa do contato mantido e move para ela TODAS as mensagens da outra (`Message.conversationId`; cuidado com os
  únicos `(conversationId, providerMessageId)` e `(conversationId, sendKey)`: em colisão, a mensagem mais antiga fica e a
  repetida é descartada — relate), os `AiJob` e `FollowUpJob` (tabelas com `conversationId`; cancele os pendentes do
  duplicado se o mantido já tiver um pendente), e recalcula os campos derivados da conversa mantida (última mensagem,
  não lidas, `lastMessageAt`, etiquetas/status/responsável: preferir o que tiver valor; modo HUMANO/atribuição do
  mantido vence). Se só o duplicado tem conversa, reaponta a conversa para o contato mantido.
- `Event.contactId`, `CampaignRecipient` (único `(campaignId, contactId)`: em colisão, fica o do mantido) e qualquer
  outra tabela com `contactId`/`conversationId` (liste-as a partir de `prisma/schema.prisma` e trate todas; notificações
  do sininho guardam `conversationId`/`contactId`? confira em `Notification`).
- Mescla nome (prefira o que não é igual ao telefone/LID), foto (`photoUrl`/`photoCheckedAt`), etiquetas (união),
  demais campos do contato (prefira o preenchido).
- Grava `AuditLog` (`organizationId` do workspace; `acao: 'contato.unificado'`; `meta` só com ids e contagens, NUNCA
  telefone/nome), apaga o contato duplicado (vazio), e emite o evento de tempo real já existente (`conversation.updated`
  com o item da conversa mantida, e algum evento que faça a lista de conversas REMOVER a duplicada: veja
  `src/server/realtime/events.ts`; se não existir nenhum, acrescente o menor possível e trate-o no cliente onde a lista
  de conversas é mantida, `src/components/conversas/**` / `app-state.tsx`).
- Idempotente: rodar de novo não muda nada. A mensagem que disparou a unificação é gravada na conversa mantida.
- Nunca perde mensagem: se a unificação falhar por qualquer motivo, a mensagem continua sendo gravada como hoje (no
  contato encontrado) e o erro é logado (`logError`), sem derrubar o webhook.

Exponha a unificação como função própria (`src/server/contacts/merge.ts`, por exemplo, `mergeContacts(workspaceId,
keepId, dupId)` + `findMergeByProof(...)`), chamada por `findOrCreateContact` e pelo script abaixo.

## Script para os duplicados já existentes
`scripts/unificar-contatos.ts`: `--dry-run` (padrão) lista, MASCARADO (`+55 11 9****-**21`, LID `2649…556`), os pares
com prova nos dados gravados: contato A com `waUserId` = LID e sem telefone, contato B com telefone e `waUserId` nulo,
e PROVA de que são o mesmo cliente. Com os dados gravados hoje, prova possível: alguma `Message` das conversas cujo
`providerMessageId`/`remoteJid` guardado ligue o LID ao telefone? Investigue o que o modelo `Message`/`Conversation`
guarda (por exemplo, `WebhookInbox` ainda tem o corpo bruto dos webhooks recentes com `remoteJidAlt`). Se NÃO houver
prova possível, o script deve dizer isso claramente e listar só os candidatos SEM prova como "não unificável
automaticamente". `--apply` unifica só os pares com prova, um por transação, com o mesmo `mergeContacts`. Nunca rode
contra produção; aqui só existe o banco local.

## Testes (UMA rodada; `tests/internacional/unificacao.test.ts`, schema `c`, ENGINE_DISABLED=true, Evolution falsa se
precisar na porta 3053 — reaproveite `tests/_fakes/test-db.ts` e o padrão de `tests/lid-contacts.test.ts`)
- com prova (contato A só LID com conversa e 2 mensagens; contato B só telefone com conversa, 1 mensagem, 1 evento da
  agenda, 1 destinatário de disparo, 1 follow-up pendente) → `ingestInboundMessage` com `{ waUserId: LID, telefone }`
  deixa UM contato (o mais antigo), UMA conversa com as 4 mensagens em ordem, evento/disparo/follow-up reapontados,
  `AuditLog` gravado, evento de tempo real emitido (`captureEvents`), duplicado apagado;
- sem prova (dois contatos, evento só com telefone) → nada muda;
- concorrência: duas `ingestInboundMessage` em paralelo (`Promise.all`) com o mesmo LID+telefone → um contato, uma
  conversa, as duas mensagens gravadas, sem erro;
- idempotência: repetir o evento não cria nem apaga nada;
- script em dry-run sobre dados semeados (com e sem prova) e `--apply` num par com prova.
Rode também uma vez `tests/lid-contacts.test.ts` e `tests/webhooks/evolution-inbox.test.ts` (leia os cabeçalhos; schema
`c`, portas 3052–3053).

Ao final: nenhum erro novo de tsc, eslint limpo nos arquivos tocados. Commits frequentes. Retorno conforme COMUM.md,
incluindo a regra final implementada, a lista de tabelas reapontadas e o que o dry-run encontraria em produção
(descreva; não há produção aqui).
