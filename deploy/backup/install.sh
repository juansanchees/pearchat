#!/usr/bin/env bash
# Instala o backup diario do PearChat na VPS (idempotente). Roda como root.
#   bash deploy/backup/install.sh [--no-first-run]
# - cria /opt/pearchat-backups (700) e a chave /root/.pearchat-backup-key (600) se faltar;
# - cron diario 03:30 de Sao Paulo (= 06:30 UTC; o Brasil nao tem horario de verao) em /etc/cron.d/pearchat-backup;
# - cria /etc/pearchat-backup.conf (600) de exemplo, com a copia externa DESLIGADA;
# - roda um primeiro backup de teste e mostra o resultado (pule com --no-first-run, usado pelo deploy).
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/pearchat-backups}"
KEY_FILE="${BACKUP_KEY_FILE:-/root/.pearchat-backup-key}"
CONF=/etc/pearchat-backup.conf
CRON=/etc/cron.d/pearchat-backup

FIRST_RUN=1
[ "${1:-}" = "--no-first-run" ] && FIRST_RUN=0

[ "$(id -u)" = 0 ] || { echo "ERRO: rode como root"; exit 1; }
for c in docker openssl tar sha256sum; do command -v "$c" >/dev/null 2>&1 || { echo "ERRO: comando ausente: $c"; exit 1; }; done
[ -d /etc/cron.d ] || { echo "ERRO: /etc/cron.d inexistente (instale o cron)"; exit 1; }

mkdir -p "$BACKUP_ROOT"; chmod 700 "$BACKUP_ROOT"
chmod +x "$HERE"/backup.sh "$HERE"/restore.sh "$HERE"/install.sh 2>/dev/null || true

KEY_CREATED=0
if [ ! -s "$KEY_FILE" ]; then
  openssl rand -base64 36 | tr -d '\n' > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  KEY_CREATED=1
fi
chmod 600 "$KEY_FILE"

if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<'EOF'
# Configuracao opcional do backup do PearChat (lida por backup.sh e restore.sh). Permissao 600.
# SEM BACKUP_REMOTE o backup existe SOMENTE neste servidor: se a VPS for perdida, o backup vai junto.
# Copia para fora do servidor, via rclone (instale e configure antes: rclone config):
#BACKUP_REMOTE=rclone:meuremote:pearchat-backups
# Apaga na nuvem os pacotes com mais de N dias (vazio = nunca apaga):
#BACKUP_REMOTE_KEEP_DAYS=45
# Retencao local (padrao 7 / 4 / 3):
#BACKUP_KEEP_DAILY=7
#BACKUP_KEEP_WEEKLY=4
#BACKUP_KEEP_MONTHLY=3
# Imagem do pg_dump (a versao deve ser >= a do Postgres do Supabase):
#BACKUP_PG_IMAGE=postgres:17-alpine
EOF
  chmod 600 "$CONF"
fi

cat > "$CRON" <<EOF
# PearChat: backup diario (03:30 de Sao Paulo = 06:30 UTC). Gerado por deploy/backup/install.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 6 * * * root bash $HERE/backup.sh >/dev/null 2>&1
EOF
chmod 644 "$CRON"

# ---- avisos ----
if [ "$KEY_CREATED" = 1 ]; then
  if [ -t 1 ] && [ "$FIRST_RUN" = 1 ]; then
    cat <<EOF

================================================================================
  CHAVE DE CRIPTOGRAFIA DOS BACKUPS  (mostrada UMA unica vez)

      $(cat "$KEY_FILE")

  COPIE AGORA para FORA do servidor (gerenciador de senhas, cofre da empresa).
  Sem esta chave NENHUM backup pode ser aberto, e se a VPS for perdida a chave
  vai junto com ela. Arquivo no servidor: $KEY_FILE
================================================================================

EOF
    read -r -p "Digite 'guardei' depois de copiar a chave: " ack < /dev/tty || true
  else
    echo "chave de backup criada em $KEY_FILE — COPIE PARA FORA DO SERVIDOR (cat $KEY_FILE)"
  fi
else
  echo "chave de backup ja existe em $KEY_FILE (mantida)"
fi
echo "cron instalado: $CRON (diario 03:30 de Sao Paulo)"
if grep -qE '^[[:space:]]*BACKUP_REMOTE=.+' "$CONF" 2>/dev/null; then
  echo "copia externa: configurada em $CONF"
else
  echo "ATENCAO: copia externa NAO configurada. Sem BACKUP_REMOTE o backup e SOMENTE LOCAL (nao protege contra perda da VPS). Veja deploy/backup/README.md"
fi

if [ "$FIRST_RUN" = 1 ]; then
  echo; echo "Rodando um primeiro backup de teste (pode levar alguns minutos) ..."
  rc=0; bash "$HERE/backup.sh" || rc=$?
  echo; echo "--- resultado (codigo $rc)"
  cat "$BACKUP_ROOT/last-status.json" 2>/dev/null || true
  echo "--- pasta"; ls -lh "$BACKUP_ROOT" | head -n 20
  [ "$rc" = 0 ] || { echo "O backup de teste falhou/parcial: veja /var/log/pearchat-backup.log"; exit "$rc"; }
fi
echo "install do backup: ok"
