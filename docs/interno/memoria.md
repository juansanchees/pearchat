# Memória do assistente (cópia dos arquivos de memória do computador principal, 07/10/2026)

---- pearchat-prioridades.md
---
name: pearchat-prioridades
description: "Prioridades do dono do PearChat definidas em 04/10/2026 — sem tema escuro, planos/pagamentos adiados, foco em funcionar e testar"
metadata:
  node_type: memory
  type: project
  originSessionId: 12e156a7-887e-48b0-ba81-378f95c795c0
  modified: 2026-10-05T15:22:56.708Z
---

Em 04/10/2026 o dono (Juan) decidiu, depois de a fila inteira ser publicada em https://pearchat.online:

- **Tema escuro: não quer.** Não propor nem construir.
- **Planos e pagamentos (Asaas): deixar para depois.** O código está no ar com `BILLING_ENABLED=false`; não ligar, não insistir em conta Asaas nem em decisões de preço/proporcional até ele retomar o assunto.
- **Foco atual: funcionalidade funcionando e testes até estar "100%"**, principalmente o uso real (WhatsApp real, IA agendando, equipe).

- **Em 05/10/2026 ele abriu a etapa "deixar tudo mais robusto"**: segurança (contra ataque, sem APIs expostas) e redução de bugs. Combinado: primeiro três auditorias só de leitura (segurança do código, servidor/publicação, robustez/testes) com relatórios em `pearchat/.claude/tmp/auditoria/{seguranca-codigo,infra,robustez}.md`; depois um resumo para ele e correções em ondas, cada onda testada e publicada; nada é corrigido nem publicado sem ele ver o resumo. Ele desligou o computador com as auditorias no meio: se os relatórios não existirem, refazer as auditorias.

- **Em 05/10/2026 (depois de ver o resumo das auditorias) ele decidiu: "quero preparar tudo pra abrir para outros clientes e amigos".** Isso autoriza executar o endurecimento completo em ondas (onda 1: conta/limites/abuso, caminho da mensagem e motor, servidor/deploy/CI; onda 2: clientes de outros países — telefone e fuso —, unificação de contato LID×telefone, alertas e backup externo; onda 3: Next 15, CSP, suíte de testes). Publicação continua sendo avisada antes. Ele questiona esforço que não parece necessário ("isso é realmente necessário?"): justificar cada bloco pelo risco real e manter o escopo enxuto.

**Why:** ele quer validar o produto na prática antes de pensar em cobrança.

**How to apply:** priorizar correções e ajustes que apareçam nos testes reais dele; tratar pagamentos e tema escuro como fora de escopo até novo aviso.

---- sessao-cai-salvar-specs.md
---
name: sessao-cai-salvar-specs
description: Neste projeto a sessão cai com frequência (o dono desliga o computador); agentes em andamento perdem o estado e não podem ser retomados por SendMessage
metadata:
  node_type: memory
  type: feedback
  originSessionId: 5565668d-db1c-4842-8ffe-671d5c7ab9e2
  modified: 2026-10-05T16:03:28.450Z
---

No PearChat, a sessão do Claude Code é encerrada com frequência no meio do trabalho (o dono desliga o computador para dormir, ou ele desliga sozinho). Em 05/10/2026 isso derrubou 3 agentes de uma vez: o trabalho não commitado ficou nas worktrees, mas os agentes não puderam ser retomados ("No transcript found") e as especificações só existiam no texto do prompt.

**Why:** retomar custou reextrair as especificações do histórico da conversa e lançar agentes novos apontando para as worktrees antigas.

**How to apply:** antes de lançar um agente de tarefa longa, gravar a especificação em `pearchat/.claude/tmp/<etapa>/spec-*.md` e passar ao agente só o caminho; mandar todo agente fazer commits temáticos cedo e com frequência na própria branch; ao retomar depois de uma queda, olhar `git status` de cada worktree em `pearchat/.claude/worktrees/` e lançar um agente novo (sem isolamento) apontando para a worktree existente e para o arquivo de especificação. Lembrar o dono, quando ele avisar que vai desligar, de que os agentes param (o site em produção não é afetado).

