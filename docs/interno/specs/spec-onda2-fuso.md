# Etapa FUSO — fuso horário por espaço em todo o app (worktree /home/user/wt-fuso, branch onda2-fuso, schema de teste `a`, portas 3048–3049)

Leia primeiro `/tmp/pearchat-pg/specs/COMUM.md` e `docs/interno/specs/spec-onda2.md` (seção 2).

## Situação
O PC do dono criou `src/lib/timezone.ts` (único módulo de datas com fuso; `tzParts`, `zonedToInstant`, `hmOf`, `ymdOf`,
`startOfDayTz`, `startOfNextDayTz`, `nextHourTz`, `normTz`, `tzLabel`, `tzOffsetLabel`…), `Workspace.timezone` (migration
0024, padrão `America/Sao_Paulo`), `src/server/workspace-locale.ts` (`getWorkspaceTz(workspaceId)` com cache de 30 s;
`toLocale(row)`), o campo em Configurações, `useAppState().locale.timezone` no navegador, e já trocou
`src/server/calendar/time.ts` (`toInstant(date, hm, tz)`, `toHM(d, tz)`, `parseInstant(s, tz)`), `src/components/agenda/time.ts`
(`todayIn(tz)`, `zonedInstant(date, hm, tz)`, `toZoned(iso, tz)`), `src/server/booking/availability.ts` (`todayIn`,
funções com `tz`), `src/server/engine/util.ts` (removeu `spParts/spStartOfDay/spStartOfNextDay/spNextHour`; `silenceEnd`
recebe `timezone` no cfg) e o link público. Com isso a branch tem 37 erros de `tsc` nos CHAMADORES antigos
(lista em `/tmp/pearchat-pg/specs/erros-fuso.txt`). Sua tarefa: terminar a fiação do fuso em todo o app, zerar o tsc e
testar.

## Regra
Todo cálculo "de parede" (hoje, amanhã, hora do dia, dia da semana, meia-noite, próximo horário X:00) usa o fuso do
ESPAÇO dono do dado (`Workspace.timezone`), via `@/lib/timezone`. Instantes gravados não mudam. No servidor, obtenha o
fuso com `getWorkspaceTz(workspaceId)` ou incluindo `timezone` no `select` do workspace que a função já carrega (prefira o
segundo quando a linha já está na mão; evite uma consulta a mais por mensagem). No navegador, use
`useAppState().locale.timezone` (ou receba `tz` por prop/argumento em módulos puros). EXCEÇÕES de propósito: o mês de uso
(`spMonthKey`, `UsageCounter.mes`, plano/cobrança) é da CONTA e fica em Brasília; `src/server/billing/**` fica como está.
Horários das bolhas de conversa e da lista de contatos (`components/conversas/format.ts`, `components/contatos/format.ts`)
usam o relógio do navegador de quem atende: deixe assim e relate.

## Onde aplicar (confira cada um; a lista pode não estar completa — procure `spParts|spToDate|toSpHM|toSp\b|spToday|spInstant|SP_OFFSET|Sao_Paulo|Brasília|-03:00`)
1. `src/server/agent/tools.ts` (`spToDate` → `toInstant(..., tz)`; `miniCalendar(now, dias, tz)`; `localIso`), e
   `src/server/agent/prompt.ts`: "Agora (Brasília)" → "Agora (<nome do fuso do negócio>)"; "mantendo o fuso de Brasília"
   e "(horário de São Paulo)" → o fuso do negócio. A IA precisa saber o nome do fuso para falar "hoje/amanhã" certo.
   Veja onde o contexto do prompt é montado (`src/server/agent/service.ts` / `llm.ts`) e passe o fuso do workspace.
2. `src/server/calendar/scheduling.ts`, `confirmation.ts` ("amanhã" do lembrete), `google.ts` (`spToDate`), e
   `src/app/api/events/free/route.ts`.
3. Motor: `src/server/engine/rules.ts` (horário de atendimento do agente: `isWithinBusinessHours` ou equivalente, com o
   fuso do espaço), `reminders.ts` (quando o lembrete é "amanhã"), `followup.ts` (hora permitida), `campaigns.ts`
   (silêncio e agendamento de disparos: `spNextHour/spStartOfDay/spStartOfNextDay` → versões `Tz`), e
   `src/server/campaigns/recipients.ts` (mês do aniversário).
4. `src/server/results/service.ts` (dia "até" do painel de resultados).
5. Sininho: `src/server/notifications/format.ts` (servidor) e `src/components/notifications/time.ts` (navegador: as
   funções recebem `tz`; os componentes que as chamam passam `locale.timezone`).
6. Agenda no navegador: `src/components/agenda/connected-view.tsx`, `side-panel.tsx`, `week-grid.tsx` (`toSp` → `toZoned`,
   `spToday` → `todayIn`, `spInstant` → `zonedInstant`, sempre com `locale.timezone`).
7. `src/components/sidebar/use-sidebar-data.ts` ainda tem `SP_OFFSET_MS`, `-03:00` e `timeZone: 'America/Sao_Paulo'`: trocar
   pelo fuso do espaço.
8. E-mails com data/hora de agendamento, se existirem (`src/server/mail/templates.ts`, lembretes, confirmação do link):
   formatar no fuso do espaço; e-mails de cobrança ficam em Brasília.
9. Comentários desatualizados ("fuso America/Sao_Paulo", `src/server/calendar/types.ts:77`): corrigir o texto.
10. Testes antigos que quebraram: `tests/notifications/fixtures.ts`, `tests/security/abuse.test.ts` (adapte para as funções
    novas; o comportamento com o fuso padrão deve ser idêntico ao de antes).

## Testes (UMA rodada; arquivo versionado `tests/internacional/fuso.test.ts`)
Sem banco (a maior parte): `zonedToInstant`/`tzParts` em `America/Sao_Paulo` e `America/Mexico_City` (sem horário de verão
desde 2022) e um fuso com horário de verão (`America/Santiago` ou `Europe/Madrid`: a virada não pode produzir hora
inexistente/duplicada errada); `silenceEnd` 21→8 num espaço do México às 23h locais; `nextHourTz`; `miniCalendar` com fuso
do México mostra o "hoje" certo quando em UTC já é o dia seguinte; "amanhã" dos lembretes; `slotsForDay`/`windowDates`
num espaço do México (08:00 local = 14:00Z) × Brasília (08:00 = 11:00Z); horário de atendimento do agente no fuso do
espaço; sininho (`rotuloDia`/`desdeLabel` com `tz`). Com banco (schema `a`, só se for barato): um espaço em
`America/Mexico_City` e outro em `America/Sao_Paulo`, horários livres da página pública diferentes para o mesmo instante.
Rode também uma vez: `tests/notifications/sync.test.ts` (schema a) e `tests/engine/delivery.test.ts`
(`WA_MOCK=false node /tmp/pearchat-pg/test-env.mjs --schema a -- npx tsx --test --test-concurrency=1 tests/engine/delivery.test.ts`;
leia o cabeçalho do arquivo), e os unitários do CI:
`npx tsx --test tests/boot-guard.test.ts tests/health-check.test.ts tests/agent-language.test.ts tests/agent-humanize.test.ts tests/initials.test.ts tests/google-calendar-scopes.test.ts tests/security/session.test.ts tests/realtime/handshake.test.ts`.
Se um teste antigo depender de servidor na porta, use 3048/3049.

Ao final: `npx tsc --noEmit` ZERADO, eslint limpo nos arquivos tocados. Commits frequentes. Retorno conforme COMUM.md,
incluindo a lista "onde o fuso foi aplicado" e "onde NÃO foi (e por quê)".
