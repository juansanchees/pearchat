# Monitoramento do PearChat

`check.sh` roda na VPS a cada 5 minutos (`/etc/cron.d/pearchat-monitor`, instalado pelo deploy ou por `bash deploy/monitor/install.sh`). Estado em `/var/lib/pearchat-monitor/state.json`; log em `/var/log/pearchat-monitor.log` (ambos os logs, do monitor e do backup, giram semanalmente pelo logrotate `/etc/logrotate.d/pearchat`).

## O que checa

| Item | Falha quando |
|---|---|
| `site` | `https://pearchat.online/login` nao responde 200 em menos de 10 s |
| `certificado` | o certificado vence em menos de 14 dias (ou nao foi possivel le-lo) |
| `container:<nome>` / `reinicios:<nome>` | container do projeto `pearchat` fora de `running`, `unhealthy`, ou reiniciou nas ultimas 3 h |
| `disco`, `disco_backups` | uso do `/` (e da pasta de backups) >= 85% |
| `memoria` | menos de 8% de memoria disponivel |
| `backup`, `backup_remoto` | ultimo backup bom ha 36 h ou mais, ultimo backup parcial/falho, ou copia externa com erro |
| `app_saude` | `GET /api/health` (porta de loopback 8088) sem 200 ou com banco em erro |
| `agendador`, `jobs_presos` | (so com `HEALTH_TOKEN`) agendador inativo/sem tick ha mais de 120 s; jobs de IA/follow-up atrasados mais de 10 min |

O monitor so avisa nas **transicoes** (ok para falha, falha para ok) e relembra a cada 6 h enquanto a falha durar. Para evitar ruido, a maioria dos itens exige 2 checagens seguidas falhando (10 min) antes de avisar; disco, backup e reinicios avisam na primeira.

**Auto-recuperacao conservadora:** se o container `app` ficar `unhealthy` por 3 checagens seguidas, o monitor executa `docker restart` so nele (no maximo 1 vez por hora) e registra no log e no alerta. Nunca mexe em outros containers nem apaga nada.

## Alertas

Configure em `/etc/pearchat-monitor.conf` (600) ou em `deploy/.env.production`:

- `MONITOR_WEBHOOK_URL`: POST JSON `{"text": "...", "content": "..."}`. Serve para Discord (URL do webhook do canal), Slack (Incoming Webhook) e Telegram (`https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>`).
- E-mail pela Resend: `RESEND_API_KEY` e `MAIL_FROM` (ja existem no `.env.production`) mais `MONITOR_EMAIL_TO` (um ou mais enderecos separados por virgula).
- `HEALTH_TOKEN`: segredo longo e aleatorio. Defina o MESMO valor no `deploy/.env.production` (o app le) e no ambiente do monitor (le o `.env.production` sozinho), e recrie o app. Sem ele, `/api/health` responde so `ok/db/versao/uptime`.

Teste o canal: `bash /opt/pearchat/deploy/monitor/check.sh --test-alert`. Sem nenhum canal configurado, o monitor so registra em `/var/log/pearchat-monitor.log` e o instalador avisa isso.

**WhatsApp nao e canal de alerta de proposito:** o aviso sairia pelo proprio PearChat/Evolution, exatamente o que pode estar fora do ar quando o alerta e mais necessario. Use Telegram/Discord/Slack/e-mail, que independem do app.

## `GET /api/health`

Publico, `Cache-Control: no-store`, sem dados sensiveis.

    {"ok":true,"db":"ok","versao":"<commit>","uptimeSeg":1234}

Faz `SELECT 1` com timeout de 3 s: 200 se o banco responde, 503 se nao. Com o header `x-health-token: <HEALTH_TOKEN>` (comparado em tempo constante) acrescenta:

    "agendador":{"ativo":true,"ultimoTick":"...Z","idadeTickSeg":3},
    "jobsPresos":{"ia":0,"followUp":0,"soma":0,"acimaDeMin":10},
    "whatsapp":{"conectados":2,"desconectados":1,"total":3}

(contagens agregadas; nunca numeros de telefone). A `versao` vem de `.deploy-commit` (hash enviado pelo `deploy.sh`).

### Sugestao para o HEALTHCHECK do Dockerfile

Hoje o `HEALTHCHECK` consulta `/login`, que passa mesmo com o banco fora. Trocar por `/api/health` faz o Docker marcar o app `unhealthy` quando o banco cair (e dispara a auto-recuperacao do monitor, que nesse caso reiniciaria o app sem resolver um problema de banco: avalie antes). Troca sugerida (nao aplicada aqui):

    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

## Autoteste

`bash deploy/monitor/selftest.sh` exercita as transicoes e o estado com dados simulados (sem rede nem Docker).
