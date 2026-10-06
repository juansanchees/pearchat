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
# Configuracao opcional do monitor do PearChat (lida por check.sh). Permissao 600. NUNCA commite este arquivo.
# Canais de alerta: use um ou mais (tambem podem ficar em deploy/.env.production). Teste: bash deploy/monitor/check.sh --test-alert
# 0) E-MAIL (canal principal; exige o servico de e-mail Resend configurado: RESEND_API_KEY e MAIL_FROM no .env.production).
#    Varios destinos separados por virgula. Preencha NO SERVIDOR; nunca commite este arquivo.
#ALERT_EMAIL_TO=
# 1) Webhook generico (POST JSON {"title","text","content","status","host","time"}): Slack, Discord, n8n, Zapier...
#ALERT_WEBHOOK_URL=
# 2) Telegram: bot do @BotFather (token) e chat_id (passo a passo em docs/operacao/monitoramento.md)
#ALERT_TELEGRAM_BOT_TOKEN=
#ALERT_TELEGRAM_CHAT_ID=
# 3) ntfy (app de celular gratis): use um topico dificil de adivinhar
#ALERT_NTFY_URL=https://ntfy.sh/pearchat-troque-por-um-nome-longo-e-secreto
#ALERT_NTFY_TOKEN=
# (MONITOR_EMAIL_TO e o nome ANTIGO de ALERT_EMAIL_TO e continua valendo.)
# Batimento (heartbeat): um servico externo (Healthchecks.io, Better Stack) recebe um GET a cada 5 min e AVISA quando parar
# de receber (cobre a VPS inteira fora do ar, quando este monitor cai junto):
#ALERT_HEARTBEAT_URL=
# Libera os detalhes de /api/health (agendador, filas, WhatsApp, IA). O deploy gera HEALTH_TOKEN no .env.production se faltar;
# o monitor le de la. So defina aqui se quiser outro valor (o app so enxerga o do .env.production).
#HEALTH_TOKEN=
# Limites (padroes): MON_SEND_FAIL_MIN=5 MON_QUEUE_MIN=20 MON_INBOX_MAX=100 MON_DISK_MAX_PCT=85 MON_BACKUP_MAX_H=36
# MON_REQUIRE_REMOTE_BACKUP=1 (0 = parar de lembrar que o backup nao tem copia externa)
# Minutos de WhatsApp desconectado para alertar: HEALTH_WA_DOWN_MIN (padrao 30), definido no .env.production (quem le e o app).
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
[ -n "$(getv ALERT_WEBHOOK_URL)" ] && ch=1
[ -n "$(getv ALERT_TELEGRAM_BOT_TOKEN)" ] && [ -n "$(getv ALERT_TELEGRAM_CHAT_ID)" ] && ch=1
[ -n "$(getv ALERT_NTFY_URL)" ] && ch=1
[ -n "$(getv RESEND_API_KEY)" ] && [ -n "$(getv MAIL_FROM)" ] && { [ -n "$(getv ALERT_EMAIL_TO)" ] || [ -n "$(getv MONITOR_EMAIL_TO)" ]; } && ch=1
echo "monitor instalado: cron a cada 5 min (/etc/cron.d/pearchat-monitor), logs em /var/log/pearchat-monitor.log"
if [ "$ch" = 1 ]; then echo "canal de alerta: configurado (teste: bash $HERE/check.sh --test-alert)"
else echo "ATENCAO: nenhum canal de alerta configurado (ALERT_EMAIL_TO com RESEND_API_KEY/MAIL_FROM, ALERT_WEBHOOK_URL, ALERT_TELEGRAM_BOT_TOKEN+ALERT_TELEGRAM_CHAT_ID ou ALERT_NTFY_URL em $CONF; veja docs/operacao/monitoramento.md). Enquanto isso, use o monitor EXTERNO (UptimeRobot) descrito la: ele avisa por e-mail sem depender da Resend. Hoje o monitor so REGISTRA em /var/log/pearchat-monitor.log; ninguem sera avisado."; fi
[ -n "$(getv HEALTH_TOKEN)" ] || echo "dica: sem HEALTH_TOKEN o monitor nao checa agendador nem jobs presos (so banco e disponibilidade)."
echo "install do monitor: ok"
