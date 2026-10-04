#!/usr/bin/env bash
# Instala o monitor do PearChat na VPS (idempotente). Roda como root.
#   bash deploy/monitor/install.sh
# - cron a cada 5 min em /etc/cron.d/pearchat-monitor;
# - logrotate dos dois logs (monitor e backup) em /etc/logrotate.d/pearchat;
# - cria /etc/pearchat-monitor.conf (600) de exemplo e avisa se nenhum canal de alerta estiver configurado.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/pearchat}"
ENV_FILE="${ENV_FILE:-$APP_DIR/deploy/.env.production}"
CONF=/etc/pearchat-monitor.conf

[ "$(id -u)" = 0 ] || { echo "ERRO: rode como root"; exit 1; }
for c in curl openssl awk; do command -v "$c" >/dev/null 2>&1 || { echo "ERRO: comando ausente: $c"; exit 1; }; done
[ -d /etc/cron.d ] || { echo "ERRO: /etc/cron.d inexistente (instale o cron)"; exit 1; }

chmod +x "$HERE"/check.sh "$HERE"/install.sh 2>/dev/null || true
mkdir -p /var/lib/pearchat-monitor; chmod 700 /var/lib/pearchat-monitor
touch /var/log/pearchat-monitor.log /var/log/pearchat-backup.log
chmod 640 /var/log/pearchat-monitor.log /var/log/pearchat-backup.log

if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<'EOF'
# Configuracao opcional do monitor do PearChat (lida por check.sh). Permissao 600.
# Canais de alerta (use um ou mais). Tambem podem ficar em deploy/.env.production.
# Webhook generico (POST JSON {"text","content"}): Discord, Slack, ou Telegram
# (https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>):
#MONITOR_WEBHOOK_URL=
# E-mail pela Resend (RESEND_API_KEY e MAIL_FROM ja existem no .env.production):
#MONITOR_EMAIL_TO=voce@exemplo.com
# Libera detalhes de /api/health (agendador, jobs presos). Defina o MESMO valor no .env.production (le o app) e recrie o app:
#HEALTH_TOKEN=
EOF
  chmod 600 "$CONF"
fi

cat > /etc/cron.d/pearchat-monitor <<EOF
# PearChat: monitor a cada 5 minutos. Gerado por deploy/monitor/install.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root bash $HERE/check.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/pearchat-monitor

if [ -d /etc/logrotate.d ]; then
  cat > /etc/logrotate.d/pearchat <<'EOF'
/var/log/pearchat-monitor.log /var/log/pearchat-backup.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    create 640 root root
}
EOF
  chmod 644 /etc/logrotate.d/pearchat
else
  echo "(logrotate nao encontrado: logs sem rotacao)"
fi

# canais configurados?
getv() { local v="${!1:-}"; if [ -z "$v" ] && [ -f "$CONF" ]; then v="$(grep -m1 "^$1=" "$CONF" | cut -d= -f2- || true)"; fi; [ -n "$v" ] || v="$(grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d "'\"" || true)"; printf '%s' "$v"; }
ch=0
[ -n "$(getv MONITOR_WEBHOOK_URL)" ] && ch=1
[ -n "$(getv RESEND_API_KEY)" ] && [ -n "$(getv MAIL_FROM)" ] && [ -n "$(getv MONITOR_EMAIL_TO)" ] && ch=1
echo "monitor instalado: cron a cada 5 min (/etc/cron.d/pearchat-monitor), logs em /var/log/pearchat-monitor.log"
if [ "$ch" = 1 ]; then echo "canal de alerta: configurado (teste: bash $HERE/check.sh --test-alert)"
else echo "ATENCAO: nenhum canal de alerta configurado (MONITOR_WEBHOOK_URL ou MONITOR_EMAIL_TO + RESEND_API_KEY/MAIL_FROM em $CONF). Hoje o monitor so REGISTRA em /var/log/pearchat-monitor.log; ninguem sera avisado."; fi
[ -n "$(getv HEALTH_TOKEN)" ] || echo "dica: sem HEALTH_TOKEN o monitor nao checa agendador nem jobs presos (so banco e disponibilidade)."
echo "install do monitor: ok"
