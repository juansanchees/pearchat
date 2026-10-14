# Fila do orquestrador (05/10/2026)

## Em andamento (worktrees em pearchat/.claude/worktrees/)
- Onda 1A conta/limites/abuso — worktree agent-a50c1d0d218c0b520 — spec-a.md — schema pearchat_test_a
- Onda 1B mensagens/motor — worktree agent-a66cfdf2ae22a00dc — spec-b.md — schema pearchat_test_b
- Onda 1C servidor/deploy/CI — worktree agent-a9158844964ec7931 — spec-c.md (+ canal de alerta por E-MAIL, endpoint /api/health/check com token, doc UptimeRobot)
- IA mais humana — worktree própria (branch worktree-agent-abf93af734e7777ff) — schema pearchat_test_d
  - três tons bem diferentes (Direto = 1 frase; Profissional = empresa; Amigável = tamanho variável)
  - estilo de referência: conversa do herói da landing (uma linha por resposta)
  - não fingir que ouviu áudio; promessa de ação da equipe => passagem para humano
  - confirmação antes de marcar configurável (interruptor + instrução escrita), padrão ligado
- Sininho de notificações — spec-sininho.md — schema pearchat_test_e (+ "Novo agendamento" item por item, estilo do cartão da landing)
- Material da verificação do Google — docs/google-verificacao/ (commit direto no main, só docs)

## Na fila (lançar quando os agentes acima liberarem banco/arquivos; no máx. ~5 agentes usando banco ao mesmo tempo: o pooler do Supabase tem 15 conexões e é o MESMO da produção)
1. Tela /bem-vindo — SÓ dois consertos pequenos (o dono DESCARTOU em 05/10 a ideia de pedir site/Instagram e preencher automático: não construir, não propor de novo):
   - remover a nota de desenvolvimento visível "O tamanho da equipe ainda não é salvo" (ou salvar o dado);
   - saudação "BEM-VINDA, JUAN" no feminino para todos → neutra ("Boas-vindas, Juan").
2. Onda 2: telefone/fuso de clientes de outros países (México), unificação de contato LID×telefone, tipos restantes.
3. Onda 3: Next 15, CSP, suíte de testes completa, separar banco dev/prod.

## Estado às 16h45 de 05/10 e notas de integração
- NO AR: ajustes do Google (043e94d), sininho (fd2aa5a).
- Onda 1A integrada no main (7f8ad71) + correção do build sem .env (c940645: `CAP_SLOT` preguiçoso em rate-limit.ts; `npm run check:build-sem-env`). 1ª tentativa de deploy (15:50) NÃO trocou: o build no Docker quebrava com "AUTH_SECRET não configurado" na carga do módulo. Republicação agendada ~16:56.
- LIÇÃO: build local com .env não prova o build do servidor. Antes de todo deploy rodar `npm run check:build-sem-env` (simula o Docker: sem variáveis).
- Onda 1C (branch worktree-agent-a9158844964ec7931, 9 commits) pronta, NÃO integrada: muda o fluxo de deploy (precisa `deploy/.deploy.env` local com PEARCHAT_HOST/USER/KEY), recria contêineres (WhatsApp cai ~1 min), bloqueia /api/wa/evolution na borda (servidor precisa de EVOLUTION_WEBHOOK_URL=http://app:3000/api/wa/evolution — a cópia local já tem), validate.mjs lê credenciais do ambiente. Na integração: acrescentar `npm run check:build-sem-env` ao CI; guarda de inicialização × env real do servidor. SÓ PUBLICAR COM "pode" DO DONO.
- IA mais humana (branch worktree-agent-abf93af734e7777ff, 5 commits, migration 0022) pronta, NÃO integrada: toca ai-reply.ts (bloco finishAiReply), provider.ts/evolution.ts/mock.ts (sendPresence). Integrar JUNTO com a onda 1B (mesmos arquivos). SÓ PUBLICAR DEPOIS DE O DONO APROVAR o antes × depois. Recomendação pendente de decisão do dono: AI_MODEL=gpt-5.6-luna.
- Onda 1B (worktree agent-a66cfdf2ae22a00dc, 13+ commits, migration 0021) terminando testes. Depois: integração 1B + IA humana sobre o main, unificando o critério 503×401 do handshake do socket com `src/server/auth/availability.ts` (judgeSession) da 1A.
- Conta demo: senha NÃO rotacionada em produção (precisa do "pode" do dono; script scripts/rotate-demo-password.ts). O validate.mjs do main ainda usa a senha padrão.

## Depende do dono
- Google: etapa 1 (Search Console TXT no DNS da GoDaddy) — ele pausou para pedir o sininho; retomar.
- Repositório privado; chave do backup; 2FA nas contas; teto de gasto na OpenAI; rotação de chaves (fazer junto no final).
- Criar conta no UptimeRobot para alertas por e-mail (passo a passo virá em docs/operacao/monitoramento.md).
- Conferir se as automações dele estão desligadas de propósito (print mostrou 0 de 3 ligadas).
- Áudio: modelo gpt-4o-mini-transcribe liberado e testado pela chave em 05/10; produção percebe em até 6 h ou no próximo deploy.

## Estado às 22h50 de 05/10 — BRANCH FINAL PRONTA, aguardando o dono
- NO AR: c940645 (Google + sininho + onda 1A). main local = 0f1657b (+ init/stop_grace no compose), não publicado.
- BRANCH FINAL: `worktree-agent-af677b7e35f6ba508` (HEAD 81c7569) = main + 1B + IA humana + 1C, verificada. Publicar = `git merge --ff-only worktree-agent-af677b7e35f6ba508` no main, push, `bash deploy/deploy.sh` (fluxo NOVO: lê deploy/.deploy.env já criado; acompanha por https até 25 min; recria Caddy/Evolution/db/redis → WhatsApp cai ~1 min; reverte sozinho se o app não ficar saudável; `bash deploy/status.sh` mostra DEPLOY_RESULT; `bash deploy/rollback.sh` volta uma versão).
- Antes de publicar: `npm run check:build-sem-env`; conferir que `deploy/.env.production` local tem connection_limit=8 (feito) e EVOLUTION_WEBHOOK_URL=http://app:3000/api/wa/evolution (tem). Depois: health com x-health-token (caixaEntrada pendentes 0), WhatsApp reconectado, /api/health/check?token= → OK, validate.mjs (sem VALIDATE_WA_RESET). Entregar ao dono a URL do UptimeRobot com o HEALTH_TOKEN do servidor (ler via status.sh), por canal seguro.
- Aguardando o dono: (1) aprovar IA mais humana; (2) AI_MODEL=gpt-5.6-luna sim/não; (3) "pode publicar o servidor"; (4) "pode" trocar senha da demo (scripts/rotate-demo-password.ts, ROTATE_PASSWORD por env, rodar no servidor) e depois criar deploy/.validate.env com a conta de teste.

## 07/10 14h45 — publicação da onda 1 OK (14h35, WhatsApp reconectou, validate OK). Dono desligou o PC com 2 agentes no meio:
- Onda 2 (internacional/fuso/unificação): worktree agent-a7c11ab96c443d115 (branch worktree-agent-a7c11ab96c443d115), spec em `.claude/tmp/onda2/spec-onda2.md` do PC principal (cópia: docs/interno/specs não tem; recriar a partir desta descrição se precisar). Ver `git status`/`git log` da worktree; retomar com agente novo apontando para ela.
- Tela bem-vindo (salvar tamanho da equipe; saudação neutra): worktree agent-a3f36cf15fad73ad0.
- Pendente: ler HEALTH_TOKEN no servidor (1 SSH) e entregar ao dono a URL do UptimeRobot; verificação do Google passos 1–6 com o dono.

## 10/10 — ONDA 2 PRONTA na branch `onda-2-wip` (sessão na nuvem), aguardando o "pode" do dono para unir no main e publicar
- O que entrou (3 frentes, em worktrees, sobre o parcial do PC): telefone de qualquer país (`src/lib/phone.ts`, DDI padrão por espaço, busca por variantes, máscara/erro nos campos, `scripts/relatorio-telefones.ts` só leitura); fuso por espaço em TODO o app (`src/lib/timezone.ts`: agente/prompt/ferramentas, agenda, motor (silêncio, follow-up, lembretes, horário de atendimento, disparos), resultados, sininho, link público, menu lateral; mês de uso/cobrança ficam em Brasília de propósito); unificação LID × telefone com prova (`src/server/contacts/merge.ts`, evento `conversation.merged`, `scripts/unificar-contatos.ts` com `--dry-run` padrão). Specs: `docs/interno/specs/spec-onda2-*.md`.
- Conferido pelo orquestrador: tsc 0 erros; eslint limpo; 182 unitários; `tests/internacional/{fuso 18, telefone 33, unificacao 7}`; `lid-contacts` 21; `webhooks/evolution-inbox` 19 (com `--engine`); `notifications/sync` 28; `engine/delivery` 12/13 (a falha "idempotência e ordem" já existe no main neste ambiente, conferida num checkout limpo do main); `npm run check:build-sem-env` OK; passada no navegador (Playwright) com espaço em `America/Mexico_City` e DDI 52: link público mostra o fuso e horários no relógio do México, Configurações com os dois campos, contato mexicano `+52 1 55 1234 5678` e americano formatados, busca por número local acha o contato, Agenda mostra 16:00 UTC como 10:00.
- Migration: 0024 (ddiPadrao, timezone) — o deploy aplica. Nenhuma variável nova.
- Publicar = `git merge --ff-only onda-2-wip` no main (ou merge normal), push, `bash deploy/deploy.sh` (com o "pode"). Depois, no servidor e com o "pode": `npx tsx scripts/relatorio-telefones.ts` e `npx tsx scripts/unificar-contatos.ts` (dry-run) para decidir com o dono o que corrigir nos dados já gravados.
- Só o WhatsApp real confirma: Evolution aceitar brasileiro de 10 dígitos sem o 9; `remoteJidAlt`/`senderPn` vindo nos eventos reais (a unificação depende disso); IA falando "hoje/amanhã" certo fora de Brasília; Google Agenda com `timeZone` do espaço.
- Testes com banco na nuvem: Postgres 16 local (binários em /usr/lib/postgresql/16; `initdb` como `nobody` em /tmp, porta 5499, usuário `pearchat`, banco `pearchat`) + `scripts/test-env-local.mjs` (versionado nesta onda). Lançar em ordem: migrate deploy no schema, depois os testes. Não rodar `check:build-sem-env` com o dev server de pé (os dois usam `.next/`).

## 14/10 — Código por e-mail em dispositivo novo (pedido do dono em 14/10), PRONTO em `onda-2-wip`
- Regra: login por e-mail e senha, conta SEM 2FA, serviço de e-mail configurado e navegador não reconhecido → a senha certa não cria sessão; um código de 6 dígitos vai por e-mail (10 min, reenvio após 60 s, 5 por hora, trava no 5º erro) e a tela /verificar-acesso pede o código. Código certo → sessão + cookie `pc_dev` (180 dias, assinado, ligado ao `sessionVersion`: "Sair de todos os dispositivos", troca de senha/e-mail e desativar 2FA esquecem todos os dispositivos). Conta com 2FA: fluxo do app como antes. Google: não pede código. SEM e-mail configurado (produção hoje): login igual ao de antes, ninguém fica trancado. Sem migration, sem variável nova. Spec: `docs/interno/specs/spec-onda2-dispositivo.md`.
- Conferido pelo orquestrador: diff de `device.ts`, `login.ts`, `auth.ts`, `mfa.ts`, ações do login e de /verificar-acesso, `deploy/validate.mjs`; tsc 0; eslint limpo; `tests/security.test.ts` 12/12 com e sem e-mail (adaptado: o teste do TOTP usa dispositivo confiável); `tests/security/dispositivo.test.ts` 9 (com e-mail) e 2 (sem); `account` 10/17; `limits` 21; unitários 182; `check:build-sem-env` OK.
- Só vale em produção depois de o dono configurar o Resend (`docs/operacao/email-dominio.md`: domínio verificado, `RESEND_API_KEY` e `MAIL_FROM` no `.env.production` do servidor). Ao ligar o e-mail: todo mundo recebe um código no primeiro login de cada navegador; `deploy/validate.mjs` passa a marcar as etapas com sessão como PULADO (esperado).
- A tela "Confirme que é você" do Google que o dono viu é do próprio Google (conta Google dele), não do PearChat: "Mais maneiras de verificar" na própria tela do Google oferece as alternativas daquela conta.
