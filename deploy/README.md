# Deploy do PearChat (VPS)

O PearChat roda numa VPS em `/opt/pearchat`, projeto compose `pearchat` (redes `pearchat_net` e `pearchat_edge`, volumes
`pearchat_*`, containers `pearchat-*`) e tem o PROPRIO Caddy nas portas 80/443, com HTTPS automatico para
`pearchat.online` (o `www.pearchat.online` redireciona para o dominio sem www). O Zapfloo foi aposentado: seus containers
ficam PARADOS (nao apagados).

**Passo a passo para o dono (em portugues simples): `docs/operacao/publicacao.md`.** Este arquivo e a referencia tecnica dos scripts.

Servicos: `caddy` (80/443), `app` (publicado so em `127.0.0.1:8088`, para diagnostico na VPS), `evolution`,
`evolution-db`, `evolution-redis` (so rede interna). O banco do app e o Postgres externo da `DATABASE_URL`. A Evolution
chama o app por `http://app:3000/...` (rede interna; a borda NAO deixa `/api/wa/evolution` passar pela internet). A porta 8088 NAO e
publica: use sempre `https://pearchat.online`.

## Configuracao local de publicacao (nada de endereco no repositorio)

O endereco da VPS, o usuario e o caminho da chave SSH NAO ficam no repositorio. Copie `deploy/deploy.env.example` para
`deploy/.deploy.env` (ignorado pelo git) e preencha `PEARCHAT_HOST`, `PEARCHAT_USER`, `PEARCHAT_KEY`. Os scripts leem esse arquivo (ou
variaveis de ambiente com os mesmos nomes).

## O arquivo de ambiente do SERVIDOR e a fonte da verdade

`/opt/pearchat/deploy/.env.production` vive SO no servidor. O deploy nunca o envia nem o sobrescreve. A cada deploy, `env-sync.sh` apenas
ACRESCENTA chaves que faltam (ex.: `HEALTH_TOKEN`), nunca troca nem apaga um valor existente, faz copia datada (`.env.production.bak-*`,
permissao 600, guarda as 10 mais recentes) e fixa a versao das imagens que ja estao rodando (`CADDY_IMAGE`, `EVOLUTION_IMAGE`,
`EVOLUTION_DB_IMAGE`, `EVOLUTION_REDIS_IMAGE`). Antes de trocar o app, o guarda de inicializacao (`scripts/check-env.ts`) valida esse
arquivo com a imagem nova: se o app novo recusaria subir, NADA e trocado.

## Limite de SSH da VPS

A VPS BLOQUEIA conexoes SSH seguidas por cerca de 1 hora. Por isso todo script que usa SSH faz UMA unica conexao
(envio + execucao + disparo em segundo plano) e o acompanhamento e feito so por `curl`. Nao rode `deploy.sh`,
`rollback.sh` e `status.sh` em sequencia: espere cada um terminar e evite repetir em menos de ~1 h.

## Scripts (Git Bash, na raiz do projeto)

| Script | O que faz |
| --- | --- |
| `node deploy/gen-env.mjs` | So para a PRIMEIRA instalacao (gera `.env.production` a partir do `.env` local) ou para conferir. Nunca e chamado pelo deploy. Faz copia datada se o arquivo ja existir. Nao imprime valores. |
| `bash deploy/deploy-domain.sh` | PRIMEIRA publicacao com dominio. 1 conexao SSH; envia codigo e dispara `remote.sh` com `STOP_ZAPFLOO=1` em segundo plano. |
| `bash deploy/deploy.sh` | Republicacao normal. Recusa arvore com alteracoes nao commitadas (`DEPLOY_ALLOW_DIRTY=1` libera). 1 conexao SSH. Se algo falhar depois da troca, o servidor REVERTE sozinho. |
| `bash deploy/rollback.sh` | Reversao MANUAL para a versao anterior (`pearchat-app:previous`). 1 conexao SSH, em segundo plano. |
| `bash deploy/status.sh` | 1 conexao SSH, so leitura: ultimas 100 linhas de `last-deploy.log` (termina em `DEPLOY_RESULT=...`), imagens, `docker ps -a`, `df -h /`. |
| `node deploy/validate.mjs [URL]` | Validacao externa, sem SSH. Anonima por padrao; com conta de fumaca (`VALIDATE_EMAIL`/`VALIDATE_PASSWORD` em `deploy/.validate.env`) testa login, sessao, API e Socket.io. |
| `bash deploy/selftest.sh` | Autoteste local do `env-sync.sh` (sem Docker nem rede). |
| `deploy/remote.sh`, `remote-rollback.sh`, `env-sync.sh`, `lib-remote.sh`, `zapfloo-stop.sh` | Rodam NA VPS, disparados pelos scripts acima. |

## Como um deploy funciona (remote.sh)

1. `env-sync.sh` (acima).
2. Etiqueta a imagem em uso como `pearchat-app:previous` (base da reversao).
3. `docker compose build app` (o app antigo segue no ar); etiqueta tambem como `pearchat-app:<commit>` (mantem as 3 ultimas).
4. Guarda de inicializacao no ambiente do servidor; `prisma migrate deploy` em container descartavel. Falhou = nada foi trocado.
5. `docker compose up -d --build`: troca o app e RECRIA os servicos cuja configuracao mudou.
6. Espera o app `healthy`; confere o certificado.
7. **Verificacao pos-troca** (`smoke_check`): `/api/health` ok (e versao == commit enviado), `/login` 200, `/api/auth/csrf` e `/api/auth/session`, Caddy respondendo https e bloqueando `/api/dev`, Evolution de pe sem reiniciar, e a REDE INTERNA (Evolution alcanca `app:3000`; app alcanca `evolution:8080`). Falhou = **reverte sozinho** (`remote-rollback.sh`: restaura compose e Caddyfile anteriores e a imagem `previous`) e registra `DEPLOY_RESULT=fail_rolled_back`.
8. So se tudo OK: limpeza de sobras de build, instala backup e monitor.

**Regra das migracoes: ADITIVAS.** A migracao N so pode ADICIONAR (tabela, coluna anulavel ou com DEFAULT, indice). Remover, renomear ou `NOT NULL` so na migracao N+1, depois que o codigo N ja nao usa o item. Sem isso, reverter o app deixaria o banco incompativel (a reversao NAO desfaz migracoes). Antes de qualquer migracao destrutiva, rode um backup manual.

Resultados em `/opt/pearchat/deploy/last-deploy.log`: `DEPLOY_RESULT=ok` | `fail_build` | `fail_env_invalid` | `fail_caddyfile_invalid` | `fail_migrate_pre` | `fail_compose_up` | `fail_app_unhealthy` | `fail_rolled_back` | `fail_rollback_failed` | `fail_caddy_not_running` | `fail_cert_timeout` | `fail_no_env` | `fail_zapfloo_ports`.

## Primeira publicacao (deploy-domain.sh)

Pre-requisitos: DNS de `pearchat.online` e `www` apontando so para o IP da VPS; `deploy/.env.production` JA EXISTENTE NO SERVIDOR com as URLs https
(primeira instalacao: `docs/operacao/publicacao.md`; o deploy nao o envia).

    bash deploy/deploy-domain.sh
    node deploy/validate.mjs

Na VPS, `remote.sh` faz, em ordem:

1. `zapfloo-stop.sh` (so com `STOP_ZAPFLOO=1`): inventario em `deploy/zapfloo-inventory.txt`; `docker update --restart=no` +
   `docker stop` nos containers do projeto compose do Zapfloo (sem `down`/`rm`/`prune`); confere que 80/443 ficaram livres;
   comenta no crontab do root as linhas do Zapfloo (prefixo `#PEARCHAT-DISABLED# `, backup em `/root/crontab.bak-pearchat-<timestamp>`)
   e renomeia arquivos de `/etc/cron.d` dele para `<nome>.disabled-by-pearchat`; gera `deploy/zapfloo-delete-commands.txt`.
   Termina em `ZAPFLOO_STOP_RESULT=ok` ou `fail <motivo>`.
   Se falhar: NAO sobe o Caddy; sobe so `app evolution evolution-db evolution-redis` e termina em `DEPLOY_RESULT=fail_zapfloo_ports`.
2. `docker compose up -d --build` (todos os servicos, inclusive `caddy`).
3. Espera o app saudavel; 4. `prisma migrate deploy`.
5. Espera ate 3 min o Caddy obter o certificado (log `certificate obtained successfully` ou `https://pearchat.online/login` = 200 local).
6. Se o `pearchat-caddy-1` nao ficar `running`, apenas registra as ultimas 40 linhas do log (religar o Caddy do Zapfloo nao ajuda: o app dele esta parado).

Resultado: `/opt/pearchat/deploy/last-deploy.log`, terminando em `docker ps -a`, `df -h /` e `DEPLOY_RESULT=ok` ou
`fail_zapfloo_ports` / `fail_compose_up` / `fail_app_unhealthy` / `fail_migrate` / `fail_caddy_not_running` / `fail_cert_timeout`.

## Inventario e exclusao do Zapfloo

Em `/opt/pearchat/deploy/` (veja com `bash deploy/status.sh`):

- `zapfloo-inventory.txt`: containers, labels do compose, volumes, redes, imagens com tamanho, `docker system df`, `df -h /`, maiores
  diretorios, linhas de cron relacionadas (tokens mascarados), servicos systemd. Nunca contem `.env`.
- `zapfloo-delete-commands.txt`: comandos EXATOS (com os nomes reais) para apagar em definitivo containers, volumes, imagens exclusivas,
  rede, diretorio de trabalho, cache de build e backups de cron, cada um com comentario do que apaga e quanto libera. Os scripts NAO
  executam nenhum; o dono revisa e roda manualmente depois (uma conexao SSH).

## Religar o Zapfloo (se for preciso)

Atencao: ele disputa as portas 80/443 com o Caddy do PearChat. Pare antes `docker stop pearchat-caddy-1` (o PearChat fica sem HTTPS publico).

    docker start <containers listados no inventario>
    docker update --restart=unless-stopped <os mesmos containers>
    crontab /root/crontab.bak-pearchat-<timestamp>          # restaura o crontab original
    # arquivos de /etc/cron.d: mv <nome>.disabled-by-pearchat <nome>

## Riscos conhecidos

- Entre parar o Zapfloo e o Caddy novo obter o certificado o dominio fica fora do ar (alguns minutos).
- O Let's Encrypt limita emissoes por dominio/semana; evite recriar o volume `pearchat_caddy_data` (guarda os certificados).
- A troca do container do app e o restart da Evolution derrubam sessoes/QR do WhatsApp por instantes.
- `app` so em `127.0.0.1:8088`: sem Caddy no ar, o site nao esta acessivel de fora.

## Variaveis (todas opcionais, salvo indicacao)

No `.env.production` do SERVIDOR (o compose e o app leem):

| Variavel | Para que serve |
| --- | --- |
| `HEALTH_TOKEN` | libera o detalhe de `/api/health` e a rota `/api/health/check?token=...` do monitor externo. O deploy gera se faltar (minimo 16 caracteres; mais curto = rota desligada) |
| `HEALTH_CHECK_WA_DOWN_MIN` (10), `HEALTH_CHECK_WA_MAX_H` (48), `HEALTH_CHECK_JOBS_MIN` (3), `HEALTH_CHECK_JOBS_AGE_MIN` (15), `HEALTH_CHECK_SEND_FAIL_MIN` (5), `HEALTH_CHECK_AI_REFUSED_MIN` (3), `HEALTH_CHECK_INBOX_MAX` (100), `HEALTH_CHECK_INBOX_AGE_S` (600), `HEALTH_CHECK_TICK_MAX_S` (300), `HEALTH_CHECK_BACKUP_MAX_H` (48) | limites do que e CRITICO em `/api/health/check` (padroes entre parenteses) |
| `BACKUP_STATUS_FILE` (`/data/backup-status/backup.json`), `BACKUP_STATUS_DIR` (`/opt/pearchat-backups/status`) | onde o app le o status minimo do backup (pasta montada so leitura) |
| `APP_STOP_GRACE` (40s), `APP_READ_ONLY` (true), `APP_MEM_LIMIT` (1g) | tempo de encerramento do app, sistema de arquivos somente leitura (`false` = alavanca de emergencia) e limite de memoria |
| `SHUTDOWN_GRACE_MS` (25000) | prazo do desligamento gracioso do app (espera jobs em andamento). A trava final do servidor e `SHUTDOWN_GRACE_MS` + 8 s e precisa caber em `APP_STOP_GRACE` (40 s): acima de 30000 o guarda de inicializacao avisa. O compose tambem exige `init: true` no app para o SIGTERM chegar ao node |
| `CADDY_IMAGE`, `EVOLUTION_IMAGE`, `EVOLUTION_DB_IMAGE`, `EVOLUTION_REDIS_IMAGE` | versao das imagens (o `env-sync.sh` fixa a que ja esta rodando; so mude de proposito) |
| `MIGRATE_DATABASE_URL` | URL do papel DONO do schema, usada so pelo `prisma migrate deploy` do deploy (ver `docs/operacao/supabase.md`) |
| `BOOT_GUARD_ALLOW_PUBLIC_SCHEMA` | so se a producao usar de proposito o schema `public` (nao e o caso) |

Em `/etc/pearchat-monitor.conf` (ou no `.env.production`): `ALERT_EMAIL_TO` (e-mail pela Resend, canal principal; precisa de `RESEND_API_KEY` e `MAIL_FROM`), `ALERT_WEBHOOK_URL`, `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`, `ALERT_NTFY_URL` (+ `ALERT_NTFY_TOKEN`), `ALERT_HEARTBEAT_URL`, limites `MON_*` (ver `deploy/monitor/README.md`).

Em `/etc/pearchat-backup.conf`: `BACKUP_REMOTE`, `BACKUP_REMOTE_KEEP_DAYS` etc. (ver `deploy/backup/README.md`); `RESTORE_DATABASE_URL` para restaurar com o papel das migracoes.

No SEU COMPUTADOR: `PEARCHAT_HOST`, `PEARCHAT_USER`, `PEARCHAT_KEY`, `PEARCHAT_DOMAIN` (`deploy/.deploy.env`), `VALIDATE_EMAIL`, `VALIDATE_PASSWORD`, `VALIDATE_WA_RESET` (`deploy/.validate.env`), `DEPLOY_ALLOW_DIRTY=1`.

Somente desenvolvimento: `BOOT_GUARD_ALLOW_LOCAL=1` (so vale com AUTH_URL/NEXT_PUBLIC_APP_URL de localhost; num servidor de verdade vira erro).

## Logs e operacao

    ssh -i <sua-chave> <usuario>@<ip-da-vps>        # os mesmos valores de deploy/.deploy.env
    docker logs -f --tail 100 pearchat-app-1
    docker logs --tail 100 pearchat-caddy-1
    docker logs --tail 100 pearchat-evolution-1
    cd /opt/pearchat && docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production ps

## Login com Google

O botao "Continuar com Google" (login e cadastro) usa o mesmo cliente OAuth da Agenda (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` em `deploy/.env.production`; nada novo a embutir no build). Pede so `openid email profile`.

No Google Cloud (APIs e servicos > Credenciais > cliente OAuth), em "URIs de redirecionamento autorizados", cadastre alem das da Agenda:

    https://pearchat.online/api/auth/callback/google
    http://localhost:3000/api/auth/callback/google

Sem as credenciais o botao continua desabilitado ("Em breve"). Contas existentes com o mesmo e-mail sao vinculadas apenas se o Google informar e-mail verificado.

## Importacao do historico do WhatsApp (conexao rapida)

Ao conectar o numero por QR, o PearChat importa as conversas e contatos existentes (ate 200 conversas, 50 mensagens cada, ate 90 dias; grupos nao entram). O historico nunca aciona IA, follow-up nem campanhas (mensagens ficam marcadas `Message.imported`).

Requisitos na Evolution (ja no `docker-compose.prod.yml`, servico `evolution`): `DATABASE_SAVE_DATA_INSTANCE/NEW_MESSAGE/CONTACTS/CHATS/HISTORIC` e `DATABASE_SAVE_MESSAGE_UPDATE` = true. Sem elas `chat/findChats|findMessages|findContacts` voltam vazios. Depois de alterar, recrie so a Evolution:

    docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d evolution

Migration `0006_history_import` (aditiva): rode `npx prisma migrate deploy` no deploy do app.

Como funciona: a instancia nova ja nasce com `syncFullHistory` e os eventos `MESSAGES_SET`, `CHATS_SET`, `CONTACTS_SET`, `CHATS_UPSERT`. Instancias ja criadas recebem a configuracao (settings/set e webhook/set, idempotente) quando a importacao roda. O WhatsApp so entrega o historico completo no PAREAMENTO: para o numero que ja estava conectado, a Evolution passa a usar o que ja guardou desde que `DATABASE_SAVE_DATA_*` foi ligado; para trazer o historico antigo do celular e preciso desconectar e reconectar o QR. Importacao automatica ao conectar e aos 1, 3, 10 e 30 min; manual por `POST /api/wa/history/import`; status em `GET /api/wa/history`.

## Midia e audio nas conversas (Etapa 1)

Imagens, audios, videos e documentos recebidos e enviados ficam no disco, atras da interface `MediaStore` (`src/server/media/store.ts`), em `MEDIA_DIR`. Em producao: volume Docker nomeado `pearchat_media` montado em `/data/media` no servico `app` (`MEDIA_DIR=/data/media`; o `Dockerfile` cria a pasta e a entrega ao usuario nao-root `node`). Nao existe URL publica: o arquivo so sai por `GET /api/media/<messageId>`, com sessao e conferindo o workspace.

- **BACKUP: o volume `pearchat_media` PRECISA entrar no backup** (junto do banco do PearChat e do volume `evolution_instances`). Sem ele, as mensagens continuam no banco, mas as midias recebidas viram "Nao foi possivel carregar a midia" (o WhatsApp so guarda a midia por um tempo). Exemplo: `docker run --rm -v pearchat_media:/data -v "$PWD":/backup alpine tar czf /backup/pearchat_media.tgz -C /data .`
- Migration `0009_media` (aditiva): `npx prisma migrate deploy` no deploy do app (colunas novas e anulaveis em `Message`, `UsageCounter.transcricoesSeg`).
- Recebimento: a Evolution NAO precisa de `base64` no webhook; o PearChat baixa cada arquivo por `POST /chat/getBase64FromMediaMessage/{instancia}` (a Evolution acha a mensagem no banco dela, por isso `DATABASE_SAVE_DATA_NEW_MESSAGE=true` e obrigatorio, e ja esta no compose). Teto de 25 MB por arquivo.
- Envio de audio: `POST /message/sendWhatsAppAudio` converte para ogg/opus dentro da Evolution (ffmpeg embutido na imagem dela): nao precisa instalar ffmpeg no PearChat.
- Transcricao (opcional): `OPENAI_API_KEY` + `AI_TRANSCRIBE_MODEL` (padrao `gpt-4o-mini-transcribe`). O projeto da OpenAI dono da chave precisa liberar o modelo (Settings > Project > Limits > Model access, marcar `gpt-4o-mini-transcribe` ou `whisper-1` e ajustar `AI_TRANSCRIBE_MODEL`). Enquanto nao liberar, o audio aparece normalmente e a transcricao fica "indisponivel"; o PearChat testa de novo a cada 6 h sozinho.
- Visao da IA: `AI_VISION=auto` (padrao) envia a imagem da ULTIMA mensagem do cliente (ate 4 MB) ao modelo; `off` desliga.
- Limpeza (futuro): nada e apagado ao arquivar/excluir nesta etapa. Tudo de um espaco fica em `<MEDIA_DIR>/<workspaceId>/aaaa-mm/`; excluir um espaco = apagar essa pasta (ou o prefixo, num futuro S3).

## Backup, monitoramento e limpeza (pos-deploy)

Depois de cada deploy bem-sucedido, `remote.sh` (1) limpa sobras de build (`docker image prune -f` so de imagens SEM etiqueta e `docker builder prune -f --filter until=48h`; nunca `-a`, nunca volumes; as etiquetas `previous` e `<commit>` ficam) e registra o espaco livre antes/depois, e (2) instala de forma idempotente e nao bloqueante o backup diario (`deploy/backup/`, ver `deploy/backup/README.md`) e o monitor a cada 5 min (`deploy/monitor/`, ver `deploy/monitor/README.md`). Falha nessas etapas nao muda o `DEPLOY_RESULT`. O `deploy.sh`/`deploy-domain.sh` enviam `.deploy-commit` (hash do commit) para `/opt/pearchat`.

Acoes do dono: guardar `/root/.pearchat-backup-key` FORA do servidor; configurar a copia externa (`BACKUP_REMOTE`) e um canal de alerta (e-mail: `ALERT_EMAIL_TO` com o Resend, ou o monitor externo de `docs/operacao/monitoramento.md`). O `HEALTH_TOKEN` o deploy gera sozinho se faltar. Sem a copia externa o backup e somente local.
