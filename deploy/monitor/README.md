# Monitoramento do PearChat

`check.sh` roda na VPS a cada 5 minutos (`/etc/cron.d/pearchat-monitor`, instalado pelo deploy ou por `bash deploy/monitor/install.sh`). Estado em `/var/lib/pearchat-monitor/state.json`; log em `/var/log/pearchat-monitor.log` (os logs do monitor e do backup giram semanalmente pelo logrotate `/etc/logrotate.d/pearchat`).

> O monitor roda NA PROPRIA VPS: se ela inteira cair, ele cai junto e ninguem e avisado. Por isso, alem dele, crie um monitor EXTERNO gratuito (passo a passo em `docs/operacao/monitoramento.md`) e, se quiser, o batimento (`ALERT_HEARTBEAT_URL`).

## O que checa

| Item | Falha quando |
|---|---|
| `site` | a pagina `/login` nao responde 200 em menos de 10 s |
| `certificado` | o certificado vence em menos de 14 dias (ou nao foi possivel le-lo) |
| `container:<nome>` / `reinicios:<nome>` | container do projeto `pearchat` fora de `running`, `unhealthy`, ou reiniciou nas ultimas 3 h |
| `disco`, `disco_backups` | uso do `/` (e da pasta de backups) >= 85% |
| `memoria` | menos de 8% de memoria disponivel |
| `backup`, `backup_remoto` | ultimo backup bom ha 36 h ou mais, ultimo backup parcial/falho, ou copia externa com erro |
| `backup_externo` | o backup NAO tem copia externa (`BACKUP_REMOTE`): lembra a cada 6 h; desligue com `MON_REQUIRE_REMOTE_BACKUP=0` |
| `app_saude` | `GET /api/health` (porta de loopback 8088) sem 200 ou com banco em erro |

Com `HEALTH_TOKEN` (o deploy gera um em `.env.production` se faltar), `/api/health` devolve detalhes e o monitor checa tambem:

| Item | Falha quando |
|---|---|
| `agendador` | agendador inativo ou sem tick ha mais de 120 s |
| `jobs_presos` | jobs de IA/follow-up atrasados mais de 10 min |
| `fila_crescendo` | os jobs pendentes (IA + follow-up) so aumentam ha 30 min e passam de 20 (`MON_QUEUE_MIN`, `MON_QUEUE_STREAK`) |
| `envios_falhando` | 5 ou mais mensagens com falha de envio nos ultimos 15 min (`MON_SEND_FAIL_MIN`) |
| `whatsapp_desconectado` | algum WhatsApp que ja esteve conectado esta caido ha mais de 30 min (`HEALTH_WA_DOWN_MIN`, no `.env.production`). So CONTAGEM, nunca numero ou nome |
| `webhooks_acumulando` | caixa de entrada de webhooks com 100+ pendentes (`MON_INBOX_MAX`) ou o mais antigo com mais de 10 min (`MON_INBOX_AGE_S`). Ignorada enquanto a tabela nao existir |
| `ia_credito_chave` | o provedor de IA recusou chamadas (HTTP 401/402/403/429) nos ultimos 30 min: sem credito, limite de gasto estourado ou chave invalida |

O monitor so avisa nas **transicoes** (ok para falha, falha para ok) e relembra a cada 6 h enquanto a falha durar (repeticao suprimida). Para evitar ruido, a maioria dos itens exige 2 checagens seguidas falhando (10 min) antes de avisar; disco, backup, reinicios e WhatsApp avisam na primeira.

**Auto-recuperacao conservadora:** se o container `app` ficar `unhealthy` por 3 checagens seguidas, o monitor executa `docker restart` so nele (no maximo 1 vez por hora) e registra no log e no alerta. Nunca mexe em outros containers nem apaga nada. (O healthcheck do app consulta `/api/health`: com o banco fora o container fica `unhealthy`; nesse caso o restart nao resolve, mas e limitado a 1 por hora e o alerta de banco sai de qualquer forma.)

## Canais de alerta

Configure em `/etc/pearchat-monitor.conf` (600) ou em `deploy/.env.production`. Pode usar varios ao mesmo tempo:

| Variavel | Canal |
|---|---|
| `ALERT_WEBHOOK_URL` | POST JSON `{"title","text","content","status":"fail\|ok\|test","host","time"}` (Slack, Discord, n8n, Zapier). `MONITOR_WEBHOOK_URL` (nome antigo) continua valendo |
| `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` | mensagem de um bot do Telegram |
| `ALERT_NTFY_URL` (+ `ALERT_NTFY_TOKEN`) | ntfy (ex.: `https://ntfy.sh/<topico-secreto>`), com prioridade alta nas falhas |
| `ALERT_EMAIL_TO` (varios destinos separados por virgula) + `RESEND_API_KEY` e `MAIL_FROM` do `.env.production` | **e-mail pela Resend (canal principal)**. `MONITOR_EMAIL_TO` (nome antigo) continua valendo. So funciona depois que o Resend estiver configurado; sem ele, o log registra o motivo. O endereco e preenchido NO SERVIDOR, nunca no repositorio |
| `ALERT_HEARTBEAT_URL` | batimento: um GET a cada rodada; o servico (Healthchecks.io, Better Stack) avisa quando PARAR de chegar |

Teste: `bash /opt/pearchat/deploy/monitor/check.sh --test-alert` (envia por todos os canais configurados). Sem nenhum canal, o monitor so registra em `/var/log/pearchat-monitor.log` e o instalador avisa isso. Os segredos dos canais nunca aparecem em linha de comando nem em log.

**WhatsApp nao e canal de alerta de proposito:** o aviso sairia pelo proprio PearChat/Evolution, exatamente o que pode estar fora do ar quando o alerta e mais necessario.

## `GET /api/health/check?token=<HEALTH_TOKEN>` (monitor EXTERNO)

O caminho que avisa por e-mail **sem depender do Resend nem desta VPS**: um monitor externo gratuito (UptimeRobot, Better Stack) chama este endereco a cada 5 min. **200** com corpo `OK` = tudo certo; **503** com corpo `PROBLEMA: whatsapp_desconectado=1 fila_parada=3` = algo critico falhou (so categorias e contagens, nunca dado pessoal); **404** sem token ou com token errado. Resultado em cache de ~30 s; tolerante a tabela que ainda nao existe. Criticos (limites em variaveis `HEALTH_CHECK_*`, todas opcionais):

| Categoria | Quando aparece |
|---|---|
| `banco_fora` | o banco nao responde em 3 s |
| `agendador_parado` | o motor de automacoes nao teve ciclo ha 5 min (so depois de 3 min no ar; ignorado com `ENGINE_DISABLED=true`) |
| `whatsapp_desconectado=N` | N WhatsApp que JA estiveram conectados estao caidos ha mais de 10 min e menos de 48 h, em espacos com a **IA ligada**. Nunca conectado ou sem IA nao conta |
| `fila_parada=N` | 3 ou mais jobs de IA/follow-up atrasados ha mais de 15 min |
| `falhas_de_envio=N` | 5 ou mais falhas de envio em 15 min **e nenhum envio bem-sucedido** no mesmo periodo |
| `ia_sem_credito=N` | 3 ou mais chamadas de IA recusadas (HTTP 401/402/403/429) em 30 min |
| `entrada_acumulada=N` | caixa de entrada de webhooks com 100+ pendentes ou o mais antigo parado ha mais de 10 min |
| `backup_atrasado` | o ultimo backup bom tem mais de 48 h (o app le o status por uma pasta montada somente leitura; sem o arquivo, nao alarma) |

Passo a passo para o dono: `docs/operacao/monitoramento.md`.

## `GET /api/health`

Publico, `Cache-Control: no-store`. **Sem token** devolve so `{"ok":true,"db":"ok"}` (200) ou `{"ok":false,"db":"erro"}` (503): serve para monitor externo, que confere apenas o codigo HTTP. **Com** `x-health-token: <HEALTH_TOKEN>` (comparado em tempo constante) acrescenta versao, uptime, agendador, `jobsPresos`, `whatsapp` (conectados/desconectados), `filas`, `alertas` (WhatsApp caido ha muito tempo, falhas de envio, erro de IA) e a caixa de entrada de webhooks. Tudo e contagem ou idade; nunca telefone, nome ou texto de mensagem.

## Autotestes

- `bash deploy/monitor/selftest.sh`: transicoes e estado com dados simulados (sem rede nem Docker).
- `bash deploy/monitor/selftest-http.sh [porta]`: o `check.sh` inteiro contra um servidor HTTP falso local (`fake-server.mjs`): alerta ao cair, supressao de repeticao, lembrete, alerta ao voltar, os canais e-mail (Resend, falso)/webhook/Telegram/ntfy e as checagens novas.
