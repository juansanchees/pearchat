#!/usr/bin/env bash
# Monitor simples do PearChat. Roda NA VPS a cada 5 min (cron /etc/cron.d/pearchat-monitor), como root.
#   bash deploy/monitor/check.sh              roda as checagens, avisa so nas transicoes (cai / volta / lembrete a cada 6 h)
#   bash deploy/monitor/check.sh --test-alert envia um alerta de teste por TODOS os canais configurados e sai
# Checa: site (200 em <10 s) e certificado (>14 dias), containers do projeto (running/healthy e reinicios),
# disco (<85%), memoria, backup (idade, falha, copia externa) e /api/health (banco; com HEALTH_TOKEN: agendador, jobs presos,
# fila crescendo, falhas de envio em serie, WhatsApp desconectado ha muito tempo, caixa de entrada de webhooks acumulando,
# erro de credito/chave da IA). So CONTAGENS: nenhum telefone, nome ou texto de cliente passa por aqui.
# Estado: /var/lib/pearchat-monitor/state.json. Log (sem segredos): /var/log/pearchat-monitor.log
#
# CANAIS DE ALERTA (todos opcionais, qualquer combinacao; em /etc/pearchat-monitor.conf ou no .env.production):
#   ALERT_WEBHOOK_URL            POST JSON {"title","text","content","status","host","time"} (Slack/Discord/n8n/Zapier...)
#   ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID    mensagem de bot do Telegram
#   ALERT_NTFY_URL               POST de texto no ntfy (ex.: https://ntfy.sh/<topico-secreto>); ALERT_NTFY_TOKEN opcional
#   ALERT_EMAIL_TO (+ RESEND_API_KEY e MAIL_FROM do .env.production)   e-mail pela Resend (varios destinos separados por virgula);
#                                MONITOR_EMAIL_TO = nome antigo, continua valendo. O e-mail e o canal PRINCIPAL na documentacao.
#   MONITOR_WEBHOOK_URL          nome ANTIGO do webhook (continua valendo)
#   ALERT_HEARTBEAT_URL          (opcional) GET a cada rodada: servico tipo Healthchecks.io avisa quando o monitor PARA de rodar
# Outros: HEALTH_TOKEN (detalhes de /api/health), MON_* (limites; ver abaixo).
# Auto-recuperacao: app "unhealthy" por 3 checagens seguidas -> docker restart SO nele (no maximo 1x por hora).
#
# Para teste (selftest-http.sh): MON_ONLY=site,saude (so essas secoes), MON_SITE_URL, MON_HEALTH_URL, MON_STATE_DIR, MON_LOG.
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
STATE_DIR="${MONITOR_STATE_DIR:-${MON_STATE_DIR:-/var/lib/pearchat-monitor}}"
STATE="$STATE_DIR/state.json"
LOG="${MONITOR_LOG:-${MON_LOG:-/var/log/pearchat-monitor.log}}"
DISK_MAX="${MON_DISK_MAX_PCT:-85}"
MEM_MIN_PCT="${MON_MEM_MIN_PCT:-8}"
BACKUP_MAX_H="${MON_BACKUP_MAX_H:-36}"
RESTART_WINDOW="${MON_RESTART_WINDOW_SECS:-10800}"
QUEUE_MIN="${MON_QUEUE_MIN:-20}"            # fila so conta como "crescendo" a partir de N pendentes...
QUEUE_STREAK="${MON_QUEUE_STREAK:-6}"       # ...se aumentou por N rodadas seguidas (6 x 5 min = 30 min)
SEND_FAIL_MIN="${MON_SEND_FAIL_MIN:-5}"     # falhas de envio em 15 min para alertar
INBOX_MAX="${MON_INBOX_MAX:-100}"           # webhooks pendentes na caixa de entrada
INBOX_AGE_S="${MON_INBOX_AGE_S:-600}"       # idade (s) do webhook pendente mais antigo
REQUIRE_REMOTE_BACKUP="${MON_REQUIRE_REMOTE_BACKUP:-1}"
ONLY="${MON_ONLY:-}"
umask 077

sec() { [ -z "$ONLY" ] || [[ ",$ONLY," == *",$1,"* ]]; } # secao ligada?
envval() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//" -e 's/^"//' -e 's/"$//'; }
cfg() { local v="${!1:-}"; [ -n "$v" ] || v="$(envval "$1")"; printf '%s' "$v"; }
mlog() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG" 2>/dev/null || true; }

# curl com segredos fora da linha de comando (config via stdin). $1 = url, resto = linhas extras de config (header = "...").
curl_k() { local url="$1"; shift; { printf 'url = "%s"\n' "$url"; for l in "$@"; do printf '%s\n' "$l"; done; } | curl -sS -K - -m "${CURL_MAX:-10}" "${CURL_EXTRA[@]}"; }
CURL_EXTRA=()

# POST JSON de um arquivo. $1 = url, $2 = arquivo, resto = linhas de config extras. Imprime o codigo HTTP.
post_json() { local url="$1" f="$2"; shift 2; CURL_EXTRA=(-o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$f"); curl_k "$url" "$@" 2>/dev/null; }

# $1 = assunto, $2 = corpo (texto, \n entre linhas), $3 = status (fail|ok|test)
send_alert() {
  local subject="$1" body="$2" status="${3:-fail}" sent=0 tried=0 hook key from to tmp host code text now icon prio
  host="$(hostname 2>/dev/null || echo vps)"
  now="$(date -u +%FT%TZ)"
  text="[$host] $subject
$body"
  case "$status" in ok) icon="white_check_mark"; prio=default ;; test) icon="test_tube"; prio=default ;; *) icon="rotating_light"; prio=high ;; esac
  if [ "${MON_DRY_RUN:-0}" = 1 ]; then printf 'ALERTA (%s) [%s]\n%s\n' "$status" "$subject" "$body"; return 0; fi

  # 1) webhook generico (ALERT_WEBHOOK_URL e o nome antigo MONITOR_WEBHOOK_URL)
  local hooks="" h
  for h in "$(cfg ALERT_WEBHOOK_URL)" "$(cfg MONITOR_WEBHOOK_URL)"; do
    [ -n "$h" ] && [[ " $hooks " != *" $h "* ]] && hooks="$hooks $h"
  done
  for hook in $hooks; do
    tried=1
    tmp="$(mktemp)"
    printf '{"title":"%s","text":"%s","content":"%s","status":"%s","host":"%s","time":"%s"}' \
      "$(mon_json_str "$subject")" "$(mon_json_str "$text")" "$(mon_json_str "$text")" "$status" "$(mon_json_str "$host")" "$now" > "$tmp"
    code="$(post_json "$hook" "$tmp")"; rm -f "$tmp"
    case "$code" in 2*) sent=1; mlog "alerta enviado por webhook" ;; *) mlog "webhook falhou (HTTP ${code:-sem resposta})" ;; esac
  done

  # 2) Telegram
  local tg_tok tg_chat tg_base
  tg_tok="$(cfg ALERT_TELEGRAM_BOT_TOKEN)"; tg_chat="$(cfg ALERT_TELEGRAM_CHAT_ID)"; tg_base="$(cfg ALERT_TELEGRAM_API_BASE)"; tg_base="${tg_base:-https://api.telegram.org}"
  if [ -n "$tg_tok" ] && [ -n "$tg_chat" ]; then
    tried=1
    tmp="$(mktemp)"
    printf '{"chat_id":"%s","text":"%s","disable_web_page_preview":true}' "$(mon_json_str "$tg_chat")" "$(mon_json_str "$text")" > "$tmp"
    code="$(post_json "${tg_base%/}/bot$tg_tok/sendMessage" "$tmp")"; rm -f "$tmp"
    case "$code" in 2*) sent=1; mlog "alerta enviado por telegram" ;; *) mlog "telegram falhou (HTTP ${code:-sem resposta})" ;; esac
  fi

  # 3) ntfy
  local ntfy_url ntfy_tok
  ntfy_url="$(cfg ALERT_NTFY_URL)"; ntfy_tok="$(cfg ALERT_NTFY_TOKEN)"
  if [ -n "$ntfy_url" ]; then
    tried=1
    tmp="$(mktemp)"; printf '%s' "$body
(servidor $host)" > "$tmp"
    CURL_EXTRA=(-o /dev/null -w '%{http_code}' -X POST --data-binary "@$tmp")
    local extra=("header = \"Title: PearChat: $(printf '%s' "$subject" | tr -d '\r\n"' | cut -c1-120)\"" "header = \"Priority: $prio\"" "header = \"Tags: $icon\"")
    [ -n "$ntfy_tok" ] && extra+=("header = \"Authorization: Bearer $ntfy_tok\"")
    code="$(curl_k "$ntfy_url" "${extra[@]}" 2>/dev/null)"; rm -f "$tmp"
    case "$code" in 2*) sent=1; mlog "alerta enviado por ntfy" ;; *) mlog "ntfy falhou (HTTP ${code:-sem resposta})" ;; esac
  fi

  # 4) e-mail (Resend): canal PRINCIPAL quando RESEND_API_KEY + MAIL_FROM + ALERT_EMAIL_TO existem (MONITOR_EMAIL_TO = nome antigo)
  local resend_base; resend_base="$(cfg ALERT_RESEND_API_BASE)"; resend_base="${resend_base:-https://api.resend.com}"
  key="$(cfg RESEND_API_KEY)"; from="$(cfg MAIL_FROM)"; to="$(cfg ALERT_EMAIL_TO)"; [ -n "$to" ] || to="$(cfg MONITOR_EMAIL_TO)"
  if [ -n "$key" ] && [ -n "$from" ] && [ -n "$to" ]; then
    tried=1
    local arr="" t
    IFS=',' read -ra _dest <<< "$to"
    for t in "${_dest[@]}"; do t="${t// /}"; [ -n "$t" ] && arr="${arr:+$arr,}\"$(mon_json_str "$t")\""; done
    tmp="$(mktemp)"
    printf '{"from":"%s","to":[%s],"subject":"%s","text":"%s"}' "$(mon_json_str "$from")" "$arr" \
      "$(mon_json_str "[PearChat] $subject")" "$(mon_json_str "$body
(servidor $host)")" > "$tmp"
    code="$(post_json "${resend_base%/}/emails" "$tmp" "header = \"Authorization: Bearer $key\"")"; rm -f "$tmp"
    case "$code" in 2*) sent=1; mlog "alerta enviado por e-mail" ;; *) mlog "e-mail falhou (HTTP ${code:-sem resposta})" ;; esac
  elif [ -n "$to" ]; then
    mlog "e-mail NAO enviado: ALERT_EMAIL_TO definido, mas falta RESEND_API_KEY e/ou MAIL_FROM (o servico de e-mail Resend ainda nao esta configurado)"
  fi

  if [ "$tried" = 0 ]; then
    mlog "ALERTA SEM CANAL (configure ALERT_EMAIL_TO com RESEND_API_KEY/MAIL_FROM, ou ALERT_WEBHOOK_URL, ALERT_TELEGRAM_*, ALERT_NTFY_URL): $subject | $(printf '%s' "$body" | tr '\n' ' ')"
  elif [ "$sent" = 0 ]; then
    mlog "ALERTA NAO ENTREGUE por nenhum canal: $subject"
  fi
  return 0
}

if [ "${1:-}" = "--test-alert" ]; then
  send_alert "alerta de teste" "Se voce recebeu esta mensagem, este canal de alertas do monitor do PearChat funciona." test
  echo "teste enviado (veja $LOG se nada chegou)"; exit 0
fi

mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
if command -v flock >/dev/null 2>&1; then exec 8>"$STATE_DIR/.lock"; flock -n 8 || exit 0; fi

NOW="$(date +%s)"
mon_state_load "$STATE"

# ---------- 1) site e certificado ----------
if sec site; then
  SITE_URL="${MON_SITE_URL:-https://$DOMAIN/login}"
  out="$(curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}' "$SITE_URL" 2>/dev/null)"
  code="${out%% *}"; secs="${out##* }"
  if [ "$code" = 200 ] && awk "BEGIN{exit !(${secs:-99} < 10)}"; then mon_record site ok ""
  else mon_record site fail "$SITE_URL respondeu HTTP ${code:-000} em ${secs:-?}s"; fi
fi

if sec certificado; then
  cert_out="$(echo | timeout 15 openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate -checkend $((14 * 86400)) 2>&1)"
  if [ -z "$cert_out" ] || ! printf '%s' "$cert_out" | grep -q '^notAfter='; then
    mon_record certificado fail "nao foi possivel ler o certificado de $DOMAIN:443"
  elif printf '%s' "$cert_out" | grep -q 'will not expire'; then mon_record certificado ok ""
  else mon_record certificado fail "certificado vence em menos de 14 dias ($(printf '%s' "$cert_out" | grep '^notAfter=' | head -n1))"; fi
fi

# ---------- 2) containers do projeto ----------
APP_C=""
if sec containers; then
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
fi

# ---------- 3) disco ----------
if sec disco; then
  use="$(df -P / | awk 'NR==2{gsub("%","",$5);print $5}')"
  if [ "${use:-100}" -lt "$DISK_MAX" ]; then mon_record disco ok ""; else mon_record disco fail "disco / em ${use}% (limite ${DISK_MAX}%)" 1; fi
  if [ -d "$BACKUP_ROOT" ]; then
    use_b="$(df -P "$BACKUP_ROOT" | awk 'NR==2{gsub("%","",$5);print $5}')"
    if [ "${use_b:-100}" -lt "$DISK_MAX" ]; then mon_record disco_backups ok ""; else mon_record disco_backups fail "disco dos backups em ${use_b}%" 1; fi
  fi
fi

# ---------- 4) memoria ----------
if sec memoria; then
  mt="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"; ma="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)"
  if [ -n "$mt" ] && [ -n "$ma" ] && [ "$mt" -gt 0 ]; then
    pct=$((ma * 100 / mt))
    if [ "$pct" -ge "$MEM_MIN_PCT" ]; then mon_record memoria ok ""; else mon_record memoria fail "so ${pct}% de memoria disponivel (minimo ${MEM_MIN_PCT}%)"; fi
  fi
fi

# ---------- 5) backup ----------
if sec backup; then
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
  # Sem copia externa o backup morre junto com a VPS: lembra (a cada 6 h) ate o dono configurar.
  if [ "$REQUIRE_REMOTE_BACKUP" = 1 ] && [ "$b_rem" = desativado ]; then mon_record backup_externo fail "backup SEM copia externa (BACKUP_REMOTE): se a VPS for perdida, o backup vai junto. Veja docs/operacao/ e deploy/backup/restore.md" 1
  else mon_record backup_externo ok ""; fi
elif [ -f /etc/cron.d/pearchat-backup ] && [ $((NOW - $(stat -c %Y /etc/cron.d/pearchat-backup))) -gt $((BACKUP_MAX_H * 3600)) ]; then
  mon_record backup fail "backup instalado, mas nunca rodou (sem $BS)" 1
elif [ ! -f /etc/cron.d/pearchat-backup ]; then
  mon_record backup fail "backup nao instalado (rode deploy/backup/install.sh)" 1
fi
fi

# ---------- 6) saude interna (/api/health) ----------
if sec saude; then
PORT="$(cfg PEARCHAT_PORT)"; PORT="${PORT:-8088}"
TOKEN="$(cfg HEALTH_TOKEN)"
HEALTH_URL="${MON_HEALTH_URL:-http://127.0.0.1:$PORT/api/health}"
CURL_EXTRA=(-w '\n%{http_code}')
if [ -n "$TOKEN" ]; then hres="$(curl_k "$HEALTH_URL" "header = \"x-health-token: $TOKEN\"" 2>/dev/null)"
else hres="$(curl_k "$HEALTH_URL" 2>/dev/null)"; fi
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

    # fila crescendo: pendentes (IA + follow-up) aumentando por QUEUE_STREAK rodadas seguidas e acima de QUEUE_MIN
    p1="$(mon_jget "$hbody" pendentesIa)"; p2="$(mon_jget "$hbody" pendentesFollowUp)"
    if [ -n "$p1" ] && [ -n "$p2" ] && [ "$p1" -ge 0 ] 2>/dev/null && [ "$p2" -ge 0 ] 2>/dev/null; then
      pend=$((p1 + p2)); prev_p="${ST_N[fila:v]:-0}"; streak="${ST_N[fila:s]:-0}"
      if [ "$pend" -gt "$prev_p" ] && [ "$pend" -ge "$QUEUE_MIN" ]; then streak=$((streak + 1)); else streak=0; fi
      ST_N[fila:v]="$pend"; ST_S[fila:v]=ok; ST_AVISO[fila:v]=0; ST_DESDE[fila:v]="${ST_DESDE[fila:v]:-0}"
      ST_N[fila:s]="$streak"; ST_S[fila:s]=ok; ST_AVISO[fila:s]=0; ST_DESDE[fila:s]="${ST_DESDE[fila:s]:-0}"
      if [ "$streak" -ge "$QUEUE_STREAK" ]; then mon_record fila_crescendo fail "fila de jobs so cresce ha $((streak * 5)) min (${pend} pendentes: ${p1} IA, ${p2} follow-up)" 1
      else mon_record fila_crescendo ok ""; fi
    fi

    # falhas de envio em serie
    fe="$(mon_jget "$hbody" falhasEnvio15min)"
    if [ "${fe:-0}" -ge "$SEND_FAIL_MIN" ] 2>/dev/null; then mon_record envios_falhando fail "${fe} mensagens falharam nos ultimos 15 min (WhatsApp/Evolution/Meta?)"; else mon_record envios_falhando ok ""; fi

    # WhatsApp desconectado ha muito tempo (so contagem)
    wl="$(mon_jget "$hbody" waDesconectadosLongos)"; wm="$(mon_jget "$hbody" waLimiteMin)"
    if [ "${wl:-0}" -gt 0 ] 2>/dev/null; then mon_record whatsapp_desconectado fail "${wl} WhatsApp(s) desconectado(s) ha mais de ${wm:-30} min (so contagem; veja os clientes afetados no app)" 1; else mon_record whatsapp_desconectado ok ""; fi

    # caixa de entrada de webhooks acumulando (ignorada se a tabela ainda nao existe)
    it="$(mon_jget "$hbody" inboxTabela)"
    if [ -n "$it" ] && [ "$it" != ausente ] && [ "$it" != erro ]; then
      ip="$(mon_jget "$hbody" inboxPendentes)"; ia="$(mon_jget "$hbody" inboxMaisAntigoSeg)"
      if [ "${ip:-0}" -ge "$INBOX_MAX" ] 2>/dev/null || [ "${ia:-0}" -gt "$INBOX_AGE_S" ] 2>/dev/null; then
        mon_record webhooks_acumulando fail "caixa de entrada de webhooks: ${ip:-?} pendentes, o mais antigo ha ${ia:-?}s"
      else mon_record webhooks_acumulando ok ""; fi
    fi

    # IA: erro de credito/chave (HTTP 401/402/403/429) nos ultimos 30 min
    ie="$(mon_jget "$hbody" iaErroCredito30min)"
    if [ "${ie:-0}" -gt 0 ] 2>/dev/null; then mon_record ia_credito_chave fail "provedor de IA recusou ${ie} chamada(s) (HTTP 401/402/403/429): sem credito, limite de gasto ou chave invalida. Confira o painel da OpenAI"; else mon_record ia_credito_chave ok ""; fi
  fi
elif [ "$hcode" = 503 ]; then mon_record app_saude fail "/api/health: banco com erro (HTTP 503)"
else mon_record app_saude fail "/api/health sem resposta valida (HTTP ${hcode:-000})"; fi
fi

# ---------- alertas, estado e log ----------
mon_state_save "$STATE"
if [ "${#MSGS[@]}" -gt 0 ]; then
  body=""; for m in "${MSGS[@]}"; do body="${body:+$body
}- $m"; done
  subj="${MSGS[0]}"; [ "${#MSGS[@]}" -gt 1 ] && subj="$subj (+$((${#MSGS[@]} - 1)))"
  # status do alerta: so "ok" quando TODAS as mensagens sao de recuperacao
  kind=ok; for m in "${MSGS[@]}"; do case "$m" in RECUPEROU*) ;; *) kind=fail ;; esac; done
  mlog "transicao: $(printf '%s' "$body" | tr '\n' ' ')"
  send_alert "$subj" "$body" "$kind"
fi
if [ "${#FAILING[@]}" -gt 0 ]; then mlog "em falha: ${FAILING[*]}"
elif [ "$(date +%M)" -lt 5 ]; then mlog "ok (todas as checagens)"; fi

# Heartbeat (quem para de receber sabe que o proprio monitor/VPS parou).
HB="$(cfg ALERT_HEARTBEAT_URL)"
if [ -n "$HB" ] && [ "${MON_DRY_RUN:-0}" != 1 ]; then CURL_EXTRA=(-o /dev/null); curl_k "$HB" >/dev/null 2>&1 || true; fi
exit 0
