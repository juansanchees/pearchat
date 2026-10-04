#!/usr/bin/env bash
# Monitor simples do PearChat. Roda NA VPS a cada 5 min (cron /etc/cron.d/pearchat-monitor), como root.
#   bash deploy/monitor/check.sh              roda as checagens, avisa so nas transicoes
#   bash deploy/monitor/check.sh --test-alert envia um alerta de teste pelos canais configurados e sai
# Checa: site (200 em <10 s) e certificado (>14 dias), containers do projeto (running/healthy e reinicios),
# disco (<85%), memoria, idade do ultimo backup (<36 h) e /api/health (banco, agendador, jobs presos).
# Estado: /var/lib/pearchat-monitor/state.json. Log (sem segredos): /var/log/pearchat-monitor.log
# Alertas (opcionais, em /etc/pearchat-monitor.conf ou no .env.production):
#   MONITOR_WEBHOOK_URL   POST JSON {"text","content"}  (Discord/Slack/Telegram via URL)
#   RESEND_API_KEY + MAIL_FROM + MONITOR_EMAIL_TO         e-mail pela Resend (varios destinos separados por virgula)
#   HEALTH_TOKEN          libera os detalhes de /api/health (agendador, jobs presos)
# Auto-recuperacao: app "unhealthy" por 3 checagens seguidas -> docker restart SO nele (no maximo 1x por hora).
export LC_ALL=C
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck disable=SC1091
[ -f /etc/pearchat-monitor.conf ] && . /etc/pearchat-monitor.conf

APP_DIR="${APP_DIR:-/opt/pearchat}"
ENV_FILE="${ENV_FILE:-$APP_DIR/deploy/.env.production}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-pearchat}"
DOMAIN="${MONITOR_DOMAIN:-pearchat.online}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/pearchat-backups}"
STATE_DIR="${MONITOR_STATE_DIR:-/var/lib/pearchat-monitor}"
STATE="$STATE_DIR/state.json"
LOG="${MONITOR_LOG:-/var/log/pearchat-monitor.log}"
DISK_MAX="${MON_DISK_MAX_PCT:-85}"
MEM_MIN_PCT="${MON_MEM_MIN_PCT:-8}"
BACKUP_MAX_H="${MON_BACKUP_MAX_H:-36}"
RESTART_WINDOW="${MON_RESTART_WINDOW_SECS:-10800}"
umask 077

envval() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//" -e 's/^"//' -e 's/"$//'; }
cfg() { local v="${!1:-}"; [ -n "$v" ] || v="$(envval "$1")"; printf '%s' "$v"; }
mlog() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG" 2>/dev/null || true; }

# curl com segredos fora da linha de comando (config via stdin). $1 = url, resto = linhas extras de config (header = "...").
curl_k() { local url="$1"; shift; { printf 'url = "%s"\n' "$url"; for l in "$@"; do printf '%s\n' "$l"; done; } | curl -sS -K - -m "${CURL_MAX:-10}" "${CURL_EXTRA[@]}"; }
CURL_EXTRA=()

send_alert() { # $1 = assunto, $2 = corpo (texto, \n entre linhas)
  local subject="$1" body="$2" sent=0 hook key from to tmp host
  host="$(hostname 2>/dev/null || echo vps)"
  if [ "${MON_DRY_RUN:-0}" = 1 ]; then printf 'ALERTA [%s]\n%s\n' "$subject" "$body"; return 0; fi
  hook="$(cfg MONITOR_WEBHOOK_URL)"
  if [ -n "$hook" ]; then
    tmp="$(mktemp)"
    printf '{"text":"%s","content":"%s"}' "$(mon_json_str "[$host] $subject
$body")" "$(mon_json_str "[$host] $subject
$body")" > "$tmp"
    CURL_EXTRA=(-o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$tmp")
    code="$(curl_k "$hook" 2>/dev/null)"
    rm -f "$tmp"
    case "$code" in 2*) sent=1; mlog "alerta enviado por webhook" ;; *) mlog "webhook falhou (HTTP ${code:-sem resposta})" ;; esac
  fi
  key="$(cfg RESEND_API_KEY)"; from="$(cfg MAIL_FROM)"; to="$(cfg MONITOR_EMAIL_TO)"
  if [ -n "$key" ] && [ -n "$from" ] && [ -n "$to" ]; then
    local arr="" t
    IFS=',' read -ra _dest <<< "$to"
    for t in "${_dest[@]}"; do t="${t// /}"; [ -n "$t" ] && arr="${arr:+$arr,}\"$(mon_json_str "$t")\""; done
    tmp="$(mktemp)"
    printf '{"from":"%s","to":[%s],"subject":"%s","text":"%s"}' "$(mon_json_str "$from")" "$arr" \
      "$(mon_json_str "[PearChat] $subject")" "$(mon_json_str "$body
(servidor $host)")" > "$tmp"
    CURL_EXTRA=(-o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$tmp")
    code="$(curl_k "https://api.resend.com/emails" "header = \"Authorization: Bearer $key\"" 2>/dev/null)"
    rm -f "$tmp"
    case "$code" in 2*) sent=1; mlog "alerta enviado por e-mail" ;; *) mlog "e-mail falhou (HTTP ${code:-sem resposta})" ;; esac
  fi
  [ "$sent" = 1 ] || mlog "ALERTA SEM CANAL (configure MONITOR_WEBHOOK_URL ou RESEND_API_KEY/MAIL_FROM/MONITOR_EMAIL_TO): $subject | $(printf '%s' "$body" | tr '\n' ' ')"
}

if [ "${1:-}" = "--test-alert" ]; then
  send_alert "alerta de teste" "Se voce recebeu esta mensagem, o canal de alertas do monitor do PearChat funciona."
  echo "teste enviado (veja $LOG se nada chegou)"; exit 0
fi

mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
if command -v flock >/dev/null 2>&1; then exec 8>"$STATE_DIR/.lock"; flock -n 8 || exit 0; fi

NOW="$(date +%s)"
mon_state_load "$STATE"

# ---------- 1) site e certificado ----------
out="$(curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}' "https://$DOMAIN/login" 2>/dev/null)"
code="${out%% *}"; secs="${out##* }"
if [ "$code" = 200 ] && awk "BEGIN{exit !(${secs:-99} < 10)}"; then mon_record site ok ""
else mon_record site fail "https://$DOMAIN/login respondeu HTTP ${code:-000} em ${secs:-?}s"; fi

cert_out="$(echo | timeout 15 openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate -checkend $((14 * 86400)) 2>&1)"
if [ -z "$cert_out" ] || ! printf '%s' "$cert_out" | grep -q '^notAfter='; then
  mon_record certificado fail "nao foi possivel ler o certificado de $DOMAIN:443"
elif printf '%s' "$cert_out" | grep -q 'will not expire'; then mon_record certificado ok ""
else mon_record certificado fail "certificado vence em menos de 14 dias ($(printf '%s' "$cert_out" | grep '^notAfter=' | head -n1))"; fi

# ---------- 2) containers do projeto ----------
APP_C=""
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  names="$(docker ps -a --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --format '{{.Names}}' 2>/dev/null)"
  [ -n "$names" ] || mon_record containers fail "nenhum container do projeto $COMPOSE_PROJECT encontrado"
  [ -z "$names" ] || mon_record containers ok ""
  for c in $names; do
    info="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' "$c" 2>/dev/null)"
    st="${info%%|*}"; rest="${info#*|}"; hl="${rest%%|*}"; rc="${rest##*|}"
    svc="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$c" 2>/dev/null)"
    [ "$svc" = app ] && APP_C="$c"
    if [ "$st" != running ]; then mon_record "container:$c" fail "estado $st"
    elif [ "$hl" = unhealthy ]; then mon_record "container:$c" fail "unhealthy"
    else mon_record "container:$c" ok ""; fi
    # reinicios: contador acumulado do Docker; compara com a rodada anterior
    prev_rc="${ST_N[rc:$c]:-}"
    if [ -n "$prev_rc" ] && [ "${rc:-0}" -gt "$prev_rc" ] 2>/dev/null; then ST_DESDE["rc:$c"]="$NOW"; fi
    ST_N["rc:$c"]="${rc:-0}"; ST_S["rc:$c"]=ok; ST_AVISO["rc:$c"]=0; [ -n "${ST_DESDE[rc:$c]:-}" ] || ST_DESDE["rc:$c"]=0
    last_rs="${ST_DESDE[rc:$c]:-0}"
    if [ "$last_rs" -gt 0 ] && [ $((NOW - last_rs)) -lt "$RESTART_WINDOW" ]; then
      mon_record "reinicios:$c" fail "reiniciou ha $(mon_dur $((NOW - last_rs))) (total ${rc})" 1
    else mon_record "reinicios:$c" ok ""; fi
  done

  # auto-recuperacao conservadora: so o app, so apos 3 checagens seguidas unhealthy, no maximo 1x por hora
  if [ -n "$APP_C" ]; then
    hl="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP_C" 2>/dev/null)"
    if [ "$hl" = unhealthy ]; then
      n=$(( ${ST_N[heal:app]:-0} + 1 ))
      last_heal="${ST_DESDE[heal:app]:-0}"
      if [ "$n" -ge 3 ] && [ $((NOW - last_heal)) -ge 3600 ]; then
        if docker restart "$APP_C" >/dev/null 2>&1; then
          mlog "auto-recuperacao: docker restart $APP_C (unhealthy por $n checagens)"
          MSGS+=("AUTO-RECUPERACAO: $APP_C estava unhealthy por $n checagens e foi reiniciado")
          last_heal="$NOW"
        else mlog "auto-recuperacao: docker restart $APP_C FALHOU"; MSGS+=("AUTO-RECUPERACAO FALHOU: nao consegui reiniciar $APP_C"); fi
        n=0
      fi
      ST_N[heal:app]="$n"
    else ST_N[heal:app]=0; fi
    ST_S[heal:app]=ok; ST_AVISO[heal:app]=0; ST_DESDE[heal:app]="${last_heal:-${ST_DESDE[heal:app]:-0}}"
  fi
else
  mon_record docker fail "docker indisponivel"
fi

# ---------- 3) disco ----------
use="$(df -P / | awk 'NR==2{gsub("%","",$5);print $5}')"
if [ "${use:-100}" -lt "$DISK_MAX" ]; then mon_record disco ok ""; else mon_record disco fail "disco / em ${use}% (limite ${DISK_MAX}%)" 1; fi
if [ -d "$BACKUP_ROOT" ]; then
  use_b="$(df -P "$BACKUP_ROOT" | awk 'NR==2{gsub("%","",$5);print $5}')"
  if [ "${use_b:-100}" -lt "$DISK_MAX" ]; then mon_record disco_backups ok ""; else mon_record disco_backups fail "disco dos backups em ${use_b}%" 1; fi
fi

# ---------- 4) memoria ----------
mt="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"; ma="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)"
if [ -n "$mt" ] && [ -n "$ma" ] && [ "$mt" -gt 0 ]; then
  pct=$((ma * 100 / mt))
  if [ "$pct" -ge "$MEM_MIN_PCT" ]; then mon_record memoria ok ""; else mon_record memoria fail "so ${pct}% de memoria disponivel (minimo ${MEM_MIN_PCT}%)"; fi
fi

# ---------- 5) backup ----------
BS="$BACKUP_ROOT/last-status.json"
if [ -f "$BS" ]; then
  b_ok="$(sed -n 's/^ *"ok": *\(true\|false\).*/\1/p' "$BS" | head -n1)"
  b_ok_epoch="$(sed -n 's/^ *"ultimoOkEpoch": *\([0-9]*\).*/\1/p' "$BS" | head -n1)"
  b_err="$(sed -n 's/^ *"erro": *"\(.*\)".*/\1/p' "$BS" | head -n1)"
  b_rem="$(sed -n 's/^ *"remoto": *"\([a-z]*\)".*/\1/p' "$BS" | head -n1)"
  age_h=$(( (NOW - ${b_ok_epoch:-0}) / 3600 ))
  if [ "${b_ok_epoch:-0}" -eq 0 ] || [ "$age_h" -ge "$BACKUP_MAX_H" ]; then mon_record backup fail "ultimo backup bom ha ${age_h} h (limite ${BACKUP_MAX_H} h). Ultimo resultado: ok=${b_ok} ${b_err}" 1
  elif [ "$b_ok" != true ]; then mon_record backup fail "ultimo backup incompleto: ${b_err}" 1
  else mon_record backup ok ""; fi
  if [ "$b_rem" = erro ]; then mon_record backup_remoto fail "a copia externa do backup falhou" 1; else mon_record backup_remoto ok ""; fi
elif [ -f /etc/cron.d/pearchat-backup ] && [ $((NOW - $(stat -c %Y /etc/cron.d/pearchat-backup))) -gt $((BACKUP_MAX_H * 3600)) ]; then
  mon_record backup fail "backup instalado, mas nunca rodou (sem $BS)" 1
elif [ ! -f /etc/cron.d/pearchat-backup ]; then
  mon_record backup fail "backup nao instalado (rode deploy/backup/install.sh)" 1
fi

# ---------- 6) saude interna (/api/health) ----------
PORT="$(cfg PEARCHAT_PORT)"; PORT="${PORT:-8088}"
TOKEN="$(cfg HEALTH_TOKEN)"
CURL_EXTRA=(-w '\n%{http_code}')
if [ -n "$TOKEN" ]; then hres="$(curl_k "http://127.0.0.1:$PORT/api/health" "header = \"x-health-token: $TOKEN\"" 2>/dev/null)"
else hres="$(curl_k "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; fi
hcode="${hres##*$'\n'}"; hbody="${hres%$'\n'*}"
if [ "$hcode" = 200 ] && [ "$(mon_jget "$hbody" ok)" = true ]; then
  mon_record app_saude ok ""
  if [ -n "$TOKEN" ]; then
    if [ "$(mon_jget "$hbody" ativo)" = true ]; then
      tick="$(mon_jget "$hbody" idadeTickSeg)"
      if [ -z "$tick" ] || [ "$tick" = null ] || [ "$tick" -gt 120 ] 2>/dev/null; then mon_record agendador fail "agendador sem tick ha ${tick:-?}s"; else mon_record agendador ok ""; fi
    else mon_record agendador fail "agendador inativo"; fi
    soma="$(mon_jget "$hbody" soma)"
    if [ "${soma:-0}" -gt 0 ] 2>/dev/null; then mon_record jobs_presos fail "${soma} jobs (IA/follow-up) atrasados ha mais de 10 min"; else mon_record jobs_presos ok ""; fi
  fi
elif [ "$hcode" = 503 ]; then mon_record app_saude fail "/api/health: banco com erro (HTTP 503)"
else mon_record app_saude fail "/api/health sem resposta valida (HTTP ${hcode:-000})"; fi

# ---------- alertas, estado e log ----------
mon_state_save "$STATE"
if [ "${#MSGS[@]}" -gt 0 ]; then
  body=""; for m in "${MSGS[@]}"; do body="${body:+$body
}- $m"; done
  subj="${MSGS[0]}"; [ "${#MSGS[@]}" -gt 1 ] && subj="$subj (+$((${#MSGS[@]} - 1)))"
  mlog "transicao: $(printf '%s' "$body" | tr '\n' ' ')"
  send_alert "$subj" "$body"
fi
if [ "${#FAILING[@]}" -gt 0 ]; then mlog "em falha: ${FAILING[*]}"
elif [ "$(date +%M)" -lt 5 ]; then mlog "ok (todas as checagens)"; fi
exit 0
