# Etapa FONE — telefone de qualquer país (worktree /home/user/wt-fone, branch onda2-fone, schema de teste `b`, portas 3050–3051)

Leia primeiro `/tmp/pearchat-pg/specs/COMUM.md` e `docs/interno/specs/spec-onda2.md` (seção 1).

## Situação
O PC do dono criou `src/lib/phone.ts` (normalização E.164 com DDI padrão por espaço, variantes BR/MX/AR, exibição por
país, máscara e erro do campo), `Workspace.ddiPadrao` (migration 0024), `getWorkspaceDdi(workspaceId)` em
`src/server/workspace-locale.ts`, e já ligou: `src/server/contacts/phone.ts` (reexporta), criação/edição manual
(`src/app/api/contacts/route.ts`, `new-contact-card.tsx`), importação por planilha (`import-parse.ts`, `import.ts`,
`api/contacts/import`), link público (`booking/public.ts`, `booking-flow.tsx`), exibição (`conversas/format.ts`,
`contacts/serialize.ts`), `api/dev/inbound`. Esta branch tem 37 erros de `tsc` que são da etapa FUSO (arquivos em
`/tmp/pearchat-pg/specs/erros-fuso.txt`): ignore-os, não os corrija, não introduza outros.

## Sua tarefa
1. AUDITORIA completa dos pontos onde um telefone entra, sai ou aparece, confirmando a regra "número que já vem com DDI
   NUNCA ganha 55; número curto sem DDI ganha o DDI padrão do espaço". Confira e ajuste onde faltar:
   - chegada pelo webhook da Evolution (`src/server/whatsapp/normalize.ts`: `jidToRef`, `toE164`; o JID já vem com DDI) e
     da Meta (`wa_id`); importação de histórico (`history-import.ts`); foto de perfil (`contacts/photo.ts`,
     `evolution.ts`/`mock.ts` `fetchProfilePicture`); envio (`whatsapp/phone.ts` `evolutionRecipient`, `cloud-api.ts`);
     exportação CSV (`contacts/export.ts`, `csv.ts`); busca de contatos por telefone (`contacts/queries.ts`: a busca por
     dígitos deve achar um número mexicano digitado sem DDI num espaço com DDI 52); disparos (`campaigns/recipients.ts`,
     só a parte de telefone; o aniversário é da etapa FUSO); `src/components/whatsapp/oficial-flow.tsx` linha ~60
     (máscara com 55 fixo: é o número do próprio negócio na Meta, use `formatPhoneDisplay`/`maskPhoneInput`);
     conversas (cabeçalho, lista) e Contatos (lista, cartão, edição: o campo de edição deve usar `maskPhoneInput` e
     `phoneInputError` com `locale.ddiPadrao`, como o cartão de novo contato já faz); `contacts/schemas.ts`.
   - Relate cada ponto numa tabela: arquivo, o que fazia, o que faz agora (ou "já estava certo").
2. Evolution 2.3.7 e o "1" do México / "9" do Brasil: tente `git clone --depth 1 --branch v2.3.7 https://github.com/EvolutionAPI/evolution-api /tmp/pearchat-pg/evolution-api`
   (se a rede recusar, tente sem `--branch`; se ainda assim falhar, diga que não foi possível e NÃO invente). Procure
   `createJid` / `formatBRNumber` / `formatMXOrARNumber` em `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`
   (ou onde estiver) e relate exatamente o que ela faz com números 52/54/55 ao enviar. Ajuste o comentário no topo de
   `src/lib/phone.ts` e em `whatsapp/phone.ts` se o que você encontrar for diferente do que está escrito.
3. `scripts/relatorio-telefones.ts` SOMENTE LEITURA: conta, por espaço, contatos com telefone suspeito (55 + 10/11 dígitos
   cujo DDD não é brasileiro válido; 55 seguido de um número que parece mexicano/argentino de 10–11 dígitos; mais de 15
   dígitos = LID gravado como telefone) e imprime só contagens e exemplos MASCARADOS (`+55 11 9****-**21`). Nunca grava.
   Uso: `node /tmp/pearchat-pg/test-env.mjs --schema b -- npx tsx scripts/relatorio-telefones.ts`. Siga o estilo de
   `scripts/rotate-demo-password.ts` (cabeçalho explicando uso e segurança).
4. Testes: `tests/internacional/telefone.test.ts` (puro, sem banco): BR com/sem 9 (10 e 11 dígitos), BR com 0 de tronco,
   com máscara, "+55…", "0055…"; MX 10 dígitos com DDI padrão 52 → `+52…` (sem acrescentar 1) e com DDI padrão 55 →
   null/não vira +55 (relate o comportamento real do `normalizePhoneE164` e o que faz sentido); "+521…" fica como está;
   AR; US 10 dígitos com DDI padrão 1 e "+1…" num espaço 55; número já internacional de 12+ dígitos NUNCA ganha 55;
   `phoneVariants`/`phoneCandidates` (BR 9º dígito, MX 1, AR 9); `formatPhoneDisplay` para BR, MX (55/33/81 e 3
   dígitos), AR, US, PT, ES, CO, CL, PE, desconhecido, LID de 15+ dígitos; `maskPhoneInput` e `phoneInputError` para 55,
   52 e 1; e o relatório em dry-run sobre dados semeados (com banco, schema `b`, só se for barato; senão teste a função
   de classificação exportada do script). Rode também uma vez `tests/lid-contacts.test.ts`
   (`node /tmp/pearchat-pg/test-env.mjs --schema b -- npx tsx --test tests/lid-contacts.test.ts`; se ele precisar de porta
   para a Evolution falsa, `FAKE_EVO_PORT=3051`).

Ao final: nenhum erro novo de tsc (compare com `erros-fuso.txt`), eslint limpo nos arquivos tocados. Commits frequentes.
Retorno conforme COMUM.md, incluindo a tabela da auditoria e o que a fonte da Evolution confirma.
