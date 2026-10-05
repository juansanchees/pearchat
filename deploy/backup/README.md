# Backup do PearChat

Backup diario, criptografado, feito NA VPS. O banco do app e Postgres no Supabase (plano gratuito, **sem backup automatico**), entao este e o unico backup que existe.

> **Sem copia externa, o backup e SOMENTE LOCAL.** Se a VPS for perdida, o backup vai junto. Configure `BACKUP_REMOTE` (secao "Copia para fora do servidor") e guarde a chave fora do servidor. O monitor lembra disso (`backup_externo`) a cada 6 h ate ser configurado.
>
> **Restauracao passo a passo (teste mensal, erro no banco, VPS perdida): `deploy/backup/restore.md`.** Para conferir que a copia da chave guardada fora do servidor esta certa, compare a `chaveImpressao` de `last-status.json` (ver restore.md).

## O que entra e o que nao entra

| Entra | Como |
|---|---|
| Schema `pearchat` do Supabase (todas as tabelas do app, inclusive `_prisma_migrations`) | `pg_dump --schema=pearchat --format=custom --no-owner --no-privileges` num container descartavel `postgres:17-alpine` |
| Banco da Evolution (`evolution-db`: instancias, chats, mensagens) | `docker exec ... pg_dump` (formato custom) |
| Volumes: `pearchat_media` (midia, quando existir), `pearchat_evolution_instances` (sessoes de WhatsApp conectadas), `pearchat_caddy_data` (certificados) | `tar.gz` por container descartavel, volume montado somente leitura |
| `/opt/pearchat/deploy/.env.production` | copia dentro do pacote criptografado. E o unico lugar com `ENCRYPTION_KEY`, `AUTH_SECRET`, etc.: **sem a `ENCRYPTION_KEY` o dump do banco nao serve** (dados criptografados) |
| `etc-pearchat-backup.conf`, `etc-pearchat-monitor.conf`, `imagens-em-uso.txt` | destino externo e canais de alerta (para reconstruir a VPS) e as imagens Docker em uso. A credencial do rclone NAO entra |
| `manifest.json` | tamanhos, hashes sha256, duracao, versao do app (commit de `/opt/pearchat/.deploy-commit`) |

Nao entram: schema `public` do Supabase (legado de outro produto), `evolution_db_data` bruto (o dump logico o substitui), Redis da Evolution (cache), `pearchat_caddy_config` (regeneravel), imagens Docker, codigo (esta no git).

Tudo e empacotado num unico `tar`, criptografado com `openssl enc -aes-256-cbc -pbkdf2 -iter 200000`. Arquivos intermediarios sao apagados com `shred` ao final (ou em caso de erro).

## Onde fica, quando roda, quanto guarda

- Pasta: `/opt/pearchat-backups/AAAA-MM-DD_HHMM/` (permissao 700) com `pearchat-AAAA-MM-DD_HHMM.tar.enc` e `manifest.json` (sem segredos).
- Cron: `/etc/cron.d/pearchat-backup`, todo dia **03:30 de Sao Paulo** (06:30 UTC).
- Rotacao: 7 diarios, 4 semanais (domingo), 3 mensais (dia 1). So apaga pastas `AAAA-MM-DD_HHMM` dentro de `/opt/pearchat-backups/`.
- Estado: `/opt/pearchat-backups/last-status.json` (`ok`, `quando`, `tamanhoBytes`, `erro`, `remoto`). O monitor alerta se o ultimo backup bom tiver mais de 36 h.
- Log: `/var/log/pearchat-backup.log` (sem segredos; a `DATABASE_URL` nunca aparece em log nem na linha de comando: vai por `--env-file` 600 num arquivo temporario apagado em seguida).
- Aborta com erro claro se houver menos de 3 GB livres (`BACKUP_MIN_FREE_GB`).
- Codigos de saida: 0 ok, 1 falha, 2 parcial (pacote gerado, mas faltou um componente opcional, ex.: dump da Evolution; `last-status.json` fica com `ok:false`).

### Quanto espaco ocupa

Estimativa (confirme no primeiro backup real, em `manifest.json`): dump do app e da Evolution ficam em MBs no inicio; a **midia** domina com o tempo (o tar nao comprime fotos/audios). Regra pratica: ate 14 pacotes retidos x (banco + midia). Com 5 GB de midia, ~70 GB. Acompanhe `df -h /` (o monitor alerta acima de 85%) e use a copia externa para nao depender do disco da VPS. Durante o backup o pico e ~2x o tamanho de UM pacote.

## Instalar

O deploy normal (`deploy.sh`) instala sozinho (`install.sh --no-first-run`, nao bloqueante). Para instalar/reinstalar a mao, na VPS:

    bash /opt/pearchat/deploy/backup/install.sh

Idempotente: cria a pasta (700), gera a chave se faltar, cria `/etc/pearchat-backup.conf` (copia externa desligada), instala o cron e roda um primeiro backup de teste. No modo interativo a chave e mostrada **uma unica vez**. Quando a chave e criada pelo deploy (nao interativo), ela nao e impressa: o log do deploy so diz "chave de backup criada em /root/.pearchat-backup-key — COPIE PARA FORA DO SERVIDOR". Leia com `cat /root/.pearchat-backup-key` e guarde.

### Onde guardar a chave

`/root/.pearchat-backup-key` (600). **Copie-a para fora do servidor** (gerenciador de senhas ou cofre da empresa), junto com este aviso: sem ela os backups nao abrem; e se a VPS for perdida, a chave guardada so no servidor se perde junto. Nao a guarde no mesmo lugar que os backups copiados para a nuvem (quem tem os dois abre tudo). Para trocar a chave: gere outra, guarde a antiga enquanto houver backups feitos com ela.

## Copia para fora do servidor (opcional, recomendado)

Com `rclone` instalado (`curl https://rclone.org/install.sh | sudo bash`) e um remote configurado (`rclone config`: Google Drive, Backblaze B2, qualquer S3...), edite `/etc/pearchat-backup.conf`:

    BACKUP_REMOTE=rclone:meuremote:pearchat-backups
    BACKUP_REMOTE_KEEP_DAYS=45        # opcional: apaga na nuvem pacotes mais velhos que N dias

Teste: `rclone lsd meuremote:` e depois `bash /opt/pearchat/deploy/backup/backup.sh`. So o `.tar.enc` (ja criptografado) e o `manifest.json` sobem. Depois do envio o backup roda `rclone check` (tamanho e hash no destino): copia que nao confere NAO conta (`remoto: "erro"` e backup "parcial"). Falha na copia deixa `remoto: "erro"` em `last-status.json` e o monitor avisa. O `rclone` NAO e instalado pelo deploy: o roteiro para o dono esta em `docs/operacao/` (Backblaze B2, Google Drive, S3).

- **Google Drive**: `rclone config` > `n` > tipo `drive`; em servidor sem navegador responda "n" em "Use auto config" e autorize num PC com `rclone authorize "drive"`.
- **Backblaze B2**: crie bucket privado e uma Application Key restrita ao bucket; tipo `b2`.
- **S3 / compativel**: tipo `s3`, informe provedor, access key e endpoint.

## Restaurar, passo a passo

`restore.sh` e interativo e nunca age sem confirmacao digitada.

1. **Validar sem restaurar** (faca isso periodicamente): `bash deploy/backup/restore.sh --verify` (lista os pacotes, pergunta qual). Descriptografa, confere hashes do manifesto, `pg_restore --list` e `tar -t`. Termina com `VERIFY_OK`.
2. **Restaurar o banco do app num schema NOVO** (padrao, nao toca em producao): `bash deploy/backup/restore.sh 2026-10-04_0330`. Cria `pearchat_restore_20261004` no mesmo banco do Supabase. Confira os dados no SQL Editor (`select count(*) from pearchat_restore_20261004."Contact"`). Para apagar depois: `DROP SCHEMA pearchat_restore_20261004 CASCADE;` (manual).
3. **Substituir a producao** (desastre): `bash deploy/backup/restore.sh --overwrite 2026-10-04_0330`. Pede o nome do schema e a palavra `SOBRESCREVER`, oferece parar o app e **renomeia** (nunca apaga) o schema atual para `pearchat_antes_<data>`. Depois suba o app (`docker start pearchat-app-1`).
4. **Volumes e Evolution**: acrescente `--volumes` (midia, sessoes da Evolution, certificados; pare antes os containers que usam cada volume) e/ou `--evolution` (substitui o banco da Evolution; confirmacao propria).
5. **Servidor novo (VPS perdida)**: instale Docker, copie o repo, grave a chave guardada em `/root/.pearchat-backup-key` (600), baixe o `.tar.enc` da nuvem para `/opt/pearchat-backups/AAAA-MM-DD_HHMM/`, extraia o `.env.production` com `bash deploy/backup/restore.sh --verify --extract-env /opt/pearchat/deploy AAAA-MM-DD_HHMM`, publique com `deploy-domain.sh`, e restaure com `--overwrite --volumes --evolution`.

Para abrir o pacote a mao: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.pearchat-backup-key -in pearchat-....tar.enc | tar -x -C pasta/`.

Observacoes: o `pg_dump` usa `--no-owner --no-privileges`; os objetos restaurados ficam do usuario que conectou. Extensoes e o schema `public` nao sao restaurados (o app nao depende deles).

## Testar a restauracao

Backup que nunca foi restaurado e uma hipotese. Todo mes: (a) `--verify`; (b) restauracao num schema novo e uma consulta de conferencia; (c) apague o schema de teste. O repositorio traz `deploy/backup/selftest.sh` (rotacao, leitura da URL, criptografia ida e volta), que roda em qualquer maquina com bash e openssl.

## LGPD

O pacote contem dados pessoais (contatos, conversas, telefones) e segredos. Trate como dado sensivel:

- Acesso: so root na VPS (700/600). Quem tem a chave E o pacote acessa tudo: guarde-os em lugares diferentes.
- Retencao: no maximo ~3 meses (mensais) no servidor; defina `BACKUP_REMOTE_KEEP_DAYS` na nuvem. Pedidos de exclusao de titulares valem para os backups tambem: eles expiram pela rotacao (registre esse prazo na politica de privacidade); nao e preciso editar pacotes antigos.
- Nuvem: use destino privado, com 2FA, e de preferencia regiao no Brasil/UE; o conteudo sai criptografado do servidor.
- Ao restaurar num schema de teste, apague-o ao terminar.

## Variaveis

`BACKUP_PG_IMAGE` (padrao `postgres:17-alpine`, versao >= a do Supabase), `BACKUP_ROOT`, `BACKUP_KEY_FILE`, `BACKUP_MIN_FREE_GB`, `BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`, `BACKUP_REMOTE`, `BACKUP_REMOTE_KEEP_DAYS`, `BACKUP_VOLUMES` (lista manual de volumes), `BACKUP_APP_SCHEMA`. Ficam em `/etc/pearchat-backup.conf` (600).
