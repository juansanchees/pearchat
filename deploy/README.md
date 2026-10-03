# Deploy do PearChat (VPS)

O PearChat roda na VPS `82.25.79.194` em `/opt/pearchat`, projeto compose `pearchat` (rede `pearchat_net`, volumes
`pearchat_*`, containers `pearchat-*`) e tem o PROPRIO Caddy nas portas 80/443, com HTTPS automatico para
`pearchat.online` (o `www.pearchat.online` redireciona para o dominio sem www). O Zapfloo foi aposentado: seus containers
ficam PARADOS (nao apagados) e o Caddy dele nao existe mais no caminho.

Servicos: `caddy` (80/443), `app` (publicado so em `127.0.0.1:8088`, para diagnostico na VPS), `evolution`,
`evolution-db`, `evolution-redis` (so rede interna). O banco do app e o Postgres externo da `DATABASE_URL`. A Evolution
chama o app por `http://app:3000/...` (rede interna). A porta 8088 NAO e mais publica: use sempre `https://pearchat.online`.

## Limite de SSH da VPS

A VPS BLOQUEIA conexoes SSH seguidas por cerca de 1 hora. Por isso todo script que usa SSH faz UMA unica conexao
(envio + execucao + disparo em segundo plano) e o acompanhamento e feito so por `curl`. Nao rode `deploy.sh`,
`deploy-domain.sh` e `status.sh` em sequencia: espere cada um terminar e evite repetir em menos de ~1 h.

## Scripts (Git Bash, na raiz do projeto)

| Script | O que faz |
| --- | --- |
| `node deploy/gen-env.mjs` | Gera `deploy/.env.production` a partir do `.env` (reaproveita segredos existentes). `PUBLIC_URL` padrao: `https://pearchat.online`. Nao imprime valores. |
| `bash deploy/deploy-domain.sh` | PRIMEIRA publicacao com dominio. 1 conexao SSH: envia codigo, `Caddyfile` e `zapfloo-stop.sh`; dispara `remote.sh` com `STOP_ZAPFLOO=1` em segundo plano. Acompanha `https://pearchat.online/login` a cada 30 s por ate 25 min (`DOMAIN_UP` / `DOMAIN_TIMEOUT`) e imprime os cabecalhos, o redirect de `http://` e o de `www`. |
| `bash deploy/deploy.sh` | Republicacao normal de codigo (dominio ja no ar). 1 conexao SSH; `remote.sh` SEM mexer no Zapfloo. Acompanha `https://pearchat.online/login` (`SITE_UP` / `SITE_TIMEOUT`). |
| `bash deploy/status.sh` | 1 conexao SSH, so leitura: ultimas 100 linhas de `last-deploy.log`, inventario e comandos de exclusao do Zapfloo (se existirem), `docker ps -a`, `df -h /`. |
| `node deploy/validate.mjs [URL]` | Validacao externa, sem SSH (login, sessao, API, Socket.io, fluxo de conexao do WhatsApp). Padrao `https://pearchat.online`. |
| `deploy/remote.sh`, `deploy/zapfloo-stop.sh` | Rodam NA VPS, disparados pelos scripts acima. |

## Primeira publicacao (deploy-domain.sh)

Pre-requisitos: DNS de `pearchat.online` e `www` apontando so para 82.25.79.194; `deploy/.env.production` com as URLs https
(`PUBLIC_URL=https://pearchat.online node deploy/gen-env.mjs`, ja feito).

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

## Logs e operacao

    ssh -i ~/.ssh/pearchat_vps root@82.25.79.194
    docker logs -f --tail 100 pearchat-app-1
    docker logs --tail 100 pearchat-caddy-1
    docker logs --tail 100 pearchat-evolution-1
    cd /opt/pearchat && docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production ps
