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
