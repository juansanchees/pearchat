# RETOMADA — PearChat (como continuar de qualquer computador)

Leia este arquivo inteiro antes de qualquer ação. Ele resume tudo o que foi combinado com o dono (Juan, j.dslsanches@gmail.com) até 07/10/2026. Complementos: `docs/interno/fila.md` (estado e fila), `docs/interno/roadmap.md` (regras e decisões antigas), `docs/interno/specs/*.md` (especificações usadas pelos agentes), `docs/operacao/*.md` (guias de servidor/publicação), `docs/google-verificacao/*.md`.

## 1. O que é
PearChat: SaaS para pequenos negócios atenderem pelo WhatsApp (conversas, agente de IA, follow-up, disparos, agenda, contatos, equipe, link público de agendamento). Produção: https://pearchat.online (VPS Hostinger, Docker Compose em /opt/pearchat; banco Postgres no Supabase, schema `pearchat`). Repositório: github.com/juansanchees/pearchat (PÚBLICO por decisão do dono → nunca commitar segredo, IP, senha). Stack: Next.js 14.2, TypeScript estrito, Prisma 6, next-auth v5, Socket.io em `server.ts`, motor em `src/server/engine`, Evolution API 2.3.7 (WhatsApp por QR), Cloud API da Meta (ainda "Em breve"), OpenAI (`gpt-5.4-nano`; chave só vê nano, luna e `gpt-4o-mini-transcribe`).

## 2. Como o dono quer que eu trabalhe (regras vindas dele)
- Modo orquestrador (CLAUDE.md global): eu planejo, delego a agentes (model explícito; sonnet para multi-arquivo, opus para julgamento, haiku para mecânico), verifico (tsc, testes, git diff, segredos) e reporto. Não edito código eu mesmo.
- Todo prompt de agente começa com "Você é um EXECUTOR… não delegue" (senão o agente herda o modo orquestrador e tenta delegar).
- Gravar a especificação de cada agente longo em `pearchat/.claude/tmp/<etapa>/spec-*.md` e passar só o caminho; mandar commitar cedo e com frequência (a sessão cai quando o dono desliga o PC; agentes não são retomáveis depois).
- Testes enxutos: cada etapa testa o que construiu + tsc/eslint/build; não repetir baterias; UM teste final grande por onda. O dono reclama de "testar demais".
- Relatar por etapas, em português simples, curto (o dono se perde em textos longos), separando "conferi pessoalmente" de "aceito pelo relatório do agente". Ser honesto sobre o que não foi testado.
- Avisar antes de publicar; só publicar coisa que muda o comportamento da IA depois de ele aprovar; nunca mexer em dados de produção sem o "pode" dele.
- Fora de escopo por decisão dele: tema escuro; pagamentos/planos (código existe, `BILLING_ENABLED=false`, não insistir); site/Instagram no cadastro; app de celular/PWA/push.
- Produto: cada WhatsApp é um espaço independente (IA, follow-up, disparos, contatos, agenda próprios); planos 1/3/5 WhatsApps; resposta manual tira a conversa da IA até "Devolver para a IA"; verde da marca `#2e9a48`; nenhum componente visual novo sem necessidade (reaproveitar o design).

## 3. Regras de ambiente (NUNCA violar)
- `pearchat/.env` e `deploy/.env.production` apontam para PRODUÇÃO. Testes só em schemas `pearchat_test_a..e` (trocar `schema=pearchat` por `schema=pearchat_test_x` no lançador, `connection_limit=2`; confirmar `select current_schema()` antes de escrever). Nunca `migrate dev/reset`, `db push`, `DROP`, `TRUNCATE`, nunca o schema `public` (tem tabelas antigas de outro projeto, Zapfloo).
- O pooler do Supabase é o MESMO da produção (poucas conexões): no máximo ~5 agentes usando banco ao mesmo tempo; um servidor de teste por agente; derrubar só os próprios PIDs; nunca `pkill` por nome.
- Chaves externas (OpenAI, Google, Meta, Resend, Asaas) VAZIAS nos lançadores de teste (o Next relê o `.env`); IA/Evolution/Graph/Asaas sempre falsos locais; só usar a OpenAI real com teto explícito de chamadas.
- Migrations à mão, só aditivas, numeradas (última: 0023), sem `prisma format`; o deploy aplica antes de trocar o app.
- VPS: só por chave SSH `~/.ssh/pearchat_vps`; o servidor aceita ≈1 conexão SSH por hora → `bash deploy/deploy.sh` (1 conexão; acompanha por https), `bash deploy/status.sh` (1 conexão), `bash deploy/rollback.sh`. Fluxo novo (onda 1C) lê `deploy/.deploy.env` (host/usuário/chave; fora do git). Antes de todo deploy: `npm run check:build-sem-env` (simula o build do Docker sem variáveis — um deploy já falhou por isso). Depois: `/api/health` (versão = commit), `node deploy/validate.mjs` (lê `deploy/.validate.env`), WhatsApp reconectado.
- Antes de commitar: varrer o diff por segredos (prefixos de chaves da OpenAI e do Google, URLs de banco, IP do servidor, senhas conhecidas), CRLF em `.sh` (devem ser LF).
- Commits: `git -c user.name="Juan Sanches" -c user.email="j.dslsanches@gmail.com" commit`, mensagem em português, última linha `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 4. Arquivos secretos (NÃO estão no GitHub; o dono guarda num gerenciador de senhas)
`pearchat/.env` · `pearchat/deploy/.env.production` · `pearchat/deploy/.deploy.env` (PEARCHAT_HOST=IP da VPS, PEARCHAT_USER=root, PEARCHAT_KEY=caminho da chave) · `pearchat/deploy/.validate.env` (VALIDATE_EMAIL/VALIDATE_PASSWORD da conta de demonstração) · chave SSH `~/.ssh/pearchat_vps`. Num computador novo: clonar o repo, instalar Node 22, `npm ci`, copiar esses arquivos para os mesmos lugares.

## 5. Estado em 07/10/2026
- NO AR (até 07/10 14h): ajustes do Google, sininho de notificações, onda 1A (conta/limites/abuso), idioma da IA, IA nas conversas pendentes, fotos dos contatos, transcrição de áudio.
- PUBLICANDO em 07/10 ~14h27 (conferir em `docs/interno/fila.md` e no `/api/health` se a versão `7d705c3` subiu): onda 1 completa = 1B (mensagem nunca perdida: `WebhookInbox`; envio incerto reconciliado; semáforo do motor; SIGTERM gracioso; automações só pausam em queda passageira; modo HUMANO inviolável) + IA mais humana (três tons bem diferentes; não finge ouvir áudio; promessa de ação da equipe vira passagem; "digitando…" com pausa 1,5–8 s; `confirmarAgendamento` configurável) + 1C (guarda de inicialização, Caddy/compose endurecidos, reversão automática, monitor com e-mail, backup, CI, docs/operacao). O deploy recria Caddy/Evolution → WhatsApp cai ~1 min. Se a versão não subiu: `bash deploy/status.sh` mostra `DEPLOY_RESULT`.
- Senha da conta demo (mariana@doceatelie.com.br) trocada em produção em 07/10 (está só em `deploy/.validate.env`).
- Decisões do dono em 07/10: IA mais humana aprovada; manter `gpt-5.4-nano` (trocar só se eu achar que melhora); publicar o servidor: sim; repositório continua público por enquanto.

## 6. Fila (o que falta), em ordem
1. Conferir a publicação da onda 1 e corrigir o que aparecer (riscos: Caddy/Evolution recriados nunca testados em servidor real; app em `read_only` — alavanca `APP_READ_ONLY=false`; `connection_limit=8` na DATABASE_URL do servidor).
2. Alertas por e-mail: ler o `HEALTH_TOKEN` do servidor (`status.sh`), montar `https://pearchat.online/api/health/check?token=…`, entregar ao dono por canal seguro e guiá-lo a criar o monitor no UptimeRobot (`docs/operacao/monitoramento.md`). Canal escolhido por ele: E-MAIL.
3. Verificação do app no Google (tirar "O Google não verificou este app"): `docs/google-verificacao/passo-a-passo.md`. O dono parou no passo 1 (TXT no DNS da GoDaddy) e precisa fazer 1→6; o site já está ajustado (escopos mínimos `calendar.events` + `calendar.calendarlist.readonly` + `calendar.freebusy`, botão oficial, aviso no app, política).
4. Pendências do dono (lembrar sem insistir demais): guardar a chave do backup fora do servidor (`cat /root/.pearchat-backup-key`); 2FA nas contas (GitHub, Hostinger, Supabase, OpenAI, GoDaddy); teto de gasto na OpenAI; conferir no Supabase se o schema `pearchat` está exposto pela Data API (`docs/operacao/supabase.md`); rotação das chaves que passaram em chat (VPS, Supabase, OpenAI, Meta) — fazer junto, no fim; Resend (e-mail) "para depois"; Meta: verificação do negócio pendente do lado dele; conferir se as automações dele estão desligadas de propósito.
5. Tela /bem-vindo: 2 consertos pequenos (remover a nota "O tamanho da equipe ainda não é salvo"; saudação neutra "Boas-vindas, Juan").
6. Onda 2: clientes de outros países (telefone mexicano sem +55, fuso por negócio), unificação de contato LID×telefone (hoje pode gerar duas conversas), tipos de mensagem restantes.
7. Onda 3: Next 15 (vários avisos do `npm audit` só se resolvem assim), CSP completa, suíte de testes versionada + CI com banco, separar banco de desenvolvimento do de produção.
8. Relatórios de auditoria (não versionados, ficaram no PC principal em `.claude/tmp/auditoria/`): se precisar, refazer as auditorias (código, infra, robustez) — o resumo das prioridades está em `docs/interno/fila.md`.

## 7. Comando para retomar
Numa sessão nova, com o repositório aberto: "Leia docs/interno/RETOMADA.md e docs/interno/fila.md e continue de onde paramos." Depois conferir `git log`, `/api/health` e `docs/interno/fila.md` antes de qualquer coisa.
