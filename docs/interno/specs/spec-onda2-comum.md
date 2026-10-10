# Regras comuns aos agentes da onda 2 (sessão na nuvem, 07/10/2026)

Você é um EXECUTOR: faça o trabalho você mesmo, no seu worktree. Não delegue a subagentes.

## Projeto
PearChat (Next.js 14.2, TypeScript estrito, Prisma 6 + Postgres, Socket.io em `server.ts`, motor em `src/server/engine/**`,
WhatsApp via Evolution API 2.3.7 em `src/server/whatsapp/**`, contatos em `src/server/contacts/**`, agenda em
`src/server/calendar/**` e `src/server/booking/**`, IA em `src/server/agent/**`). Leia antes `docs/interno/RETOMADA.md`
(seções 2 e 3) e `docs/interno/specs/spec-onda2.md` (a especificação original da onda 2; a sua parte está no arquivo da sua
etapa). O trabalho parcial do PC do dono já está na branch (`src/lib/phone.ts`, `src/lib/timezone.ts`,
`src/server/workspace-locale.ts`, migration `0024_internacional`, campos em Configurações → "Este WhatsApp", página pública).
Leia esses arquivos inteiros antes de mexer: a sua tarefa é COMPLETAR, não reescrever.

## Ambiente desta sessão (nuvem; NENHUM dado real aqui)
- `node_modules` é um link simbólico para o checkout principal (não rode `npm install`, não apague nada lá).
- Banco: Postgres LOCAL em 127.0.0.1:5499, sem dado de cliente. Cada agente tem o seu schema (`pearchat_test_<letra>`,
  já migrado). Lançador: `node /tmp/pearchat-pg/test-env.mjs --schema <letra> -- <comando>`. Ele define
  DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, WA_MOCK=true, NEXT_PUBLIC_WA_MOCK=true, ENGINE_DISABLED=true, PORT e deixa
  VAZIAS todas as chaves externas (OpenAI, Google, Meta, Resend, Asaas). `--engine` liga o motor (ENGINE_DISABLED=false)
  para os testes que precisam dele. `--port N` muda a porta do app (use SÓ a sua faixa, abaixo).
  Exemplos: `node /tmp/pearchat-pg/test-env.mjs --schema a -- npx tsx --test tests/x.test.ts`
            `node /tmp/pearchat-pg/test-env.mjs --schema a -- npx prisma migrate deploy`
- Proibido: outro schema que não o seu, `migrate dev/reset`, `db push`, `DROP`, `TRUNCATE`, matar processos por nome
  (só os PIDs que você criou), portas fora da sua faixa, qualquer chamada externa real (não há rede para isso mesmo).
- Sem `prisma format`. Migrations só aditivas e numeradas (a 0024 e a 0025 já existem; só crie uma nova se for
  indispensável, numerada 0026).
- Não há navegador para você: a passada visual fica com o orquestrador. Playwright/Chromium existem (`/opt/pw-browsers`)
  se precisar de um teste de página, mas não é obrigatório.

## Qualidade mínima antes de terminar
- `npx tsc --noEmit` sem erros no SEU worktree (a branch de partida tem 37 erros conhecidos: a etapa "fuso" os corrige;
  as outras etapas podem ignorar erros que estejam só nos arquivos listados abaixo como "da etapa fuso", mas NÃO podem
  introduzir erro novo. Para checar só os seus arquivos: `npx tsc --noEmit 2>&1 | grep -v -f /tmp/pearchat-pg/specs/erros-fuso.txt`).
- `npx eslint --no-eslintrc -c .eslintrc.json --ignore-pattern ".claude/**" <seus arquivos>` limpo.
- Testes enxutos: UM arquivo versionado por etapa em `tests/internacional/`, cobrindo o que a etapa construiu; não repita
  baterias antigas. Rode uma vez os testes antigos que a sua etapa toca (listados na etapa).
- Textos em pt-BR; nenhum componente visual novo (reaproveite `pc-input`, `pc-label`, `Field`, `Section`, pílulas, toasts).

## Entrega
- Commits temáticos e frequentes na SUA branch:
  `git -c user.name="Juan Sanches" -c user.email="j.dslsanches@gmail.com" commit -m "..."`, mensagem em português,
  última linha `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Sem push, sem merge, sem tocar em outros
  worktrees. Não commite `.env`, `.next`, `node_modules`, `.claude/`. Repositório PÚBLICO: nenhum segredo, nenhum dado real.
- Retorno final em português, direto, por tópicos: (1) hashes dos commits; (2) o que mudou, arquivo por arquivo em uma
  linha; (3) o que NÃO foi feito e por quê; (4) tabela de testes (arquivo, quantos passaram) + tsc/eslint; (5) riscos e o
  que só o WhatsApp real / produção confirma; (6) o que o orquestrador precisa saber para integrar (conflitos prováveis
  com as outras etapas, variáveis novas — idealmente nenhuma).
