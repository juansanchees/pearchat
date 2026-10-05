#!/usr/bin/env bash
# Teste do monitor COMPLETO contra um servidor HTTP falso local (sem Docker, sem VPS, sem internet):
# alerta ao cair, supressao de repeticao, alerta ao voltar, e os canais (e-mail pela Resend, webhook, Telegram, ntfy) + checagens novas.
#   bash deploy/monitor/selftest-http.sh [porta]     (padrao 3044; portas locais de teste: 3044-3045)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-3044}"
T="$(mktemp -d)"
SRV_PID=""
cleanup() { [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
fails=0
ok() { echo "  ok: $1"; }
bad() { echo "  FALHOU: $1"; fails=$((fails + 1)); }
count() { grep -c "$1" "$T/out.jsonl" 2>/dev/null || true; } # quantas linhas do registro casam

command -v node >/dev/null 2>&1 || { echo "node nao encontrado: teste ignorado"; exit 0; }
: > "$T/out.jsonl"; echo up > "$T/mode"
node "$HERE/fake-server.mjs" "$PORT" "$T/mode" "$T/out.jsonl" > "$T/srv.log" 2>&1 &
SRV_PID=$!
for _ in $(seq 1 40); do grep -q pronto "$T/srv.log" 2>/dev/null && break; sleep 0.25; done
grep -q pronto "$T/srv.log" || { echo "servidor falso nao subiu (porta $PORT ocupada?)"; cat "$T/srv.log"; exit 1; }

B="http://127.0.0.1:$PORT"
run_check() {
  env -i PATH="$PATH" HOME="$T" \
    MON_ONLY=site,saude MON_SITE_URL="$B/login" MON_HEALTH_URL="$B/api/health" HEALTH_TOKEN=tok-teste \
    ALERT_WEBHOOK_URL="$B/hook" ALERT_TELEGRAM_BOT_TOKEN=123:abc ALERT_TELEGRAM_CHAT_ID=42 ALERT_TELEGRAM_API_BASE="$B" \
    ALERT_NTFY_URL="$B/ntfy-topic" ENV_FILE=/nao/existe MON_STATE_DIR="$T/state" MON_LOG="$T/mon.log" MON_CONFIRM=2 \
    RESEND_API_KEY=re_chave_falsa_de_teste MAIL_FROM="PearChat <teste@exemplo.invalid>" \
    ALERT_EMAIL_TO="dono-a@exemplo.invalid, dono-b@exemplo.invalid" ALERT_RESEND_API_BASE="$B" \
    bash "$HERE/check.sh"
}
total() { count '"path"'; }

echo "== tudo no ar: nenhum alerta"
run_check; run_check
[ "$(total)" = 0 ] && ok "sem alertas com tudo ok" || bad "alertou sem motivo ($(total))"

echo "== cai: 1a falha isolada nao alerta; a 2a alerta uma vez em CADA canal"
echo down > "$T/mode"
run_check
[ "$(total)" = 0 ] && ok "1a falha: silencio (ruido)" || bad "alertou na 1a falha"
run_check
[ "$(count '"path":"/hook"')" = 1 ] && ok "webhook: 1 alerta" || bad "webhook: $(count '"path":"/hook"')"
[ "$(count 'sendMessage')" = 1 ] && ok "telegram: 1 alerta" || bad "telegram: $(count 'sendMessage')"
[ "$(count '"path":"/emails"')" = 1 ] && ok "e-mail (Resend): 1 alerta" || bad "e-mail: $(count '"path":"/emails"')"
grep -q '"path":"/emails"' "$T/out.jsonl" && grep -q 'dono-a@exemplo.invalid' "$T/out.jsonl" && grep -q 'dono-b@exemplo.invalid' "$T/out.jsonl" && ok "e-mail: varios destinatarios (ALERT_EMAIL_TO)" || bad "e-mail: destinatarios"
grep -q '"path":"/emails".*"auth":"sim"' "$T/out.jsonl" && ok "e-mail: chave da Resend enviada no cabecalho Authorization" || bad "e-mail: sem Authorization"
[ "$(count '"path":"/ntfy-topic"')" = 1 ] && ok "ntfy: 1 alerta" || bad "ntfy: $(count '"path":"/ntfy-topic"')"
grep -q '"path":"/bot123:abc/sendMessage"' "$T/out.jsonl" && grep -q 'chat_id\\":\\"42\|"chat_id":"42' "$T/out.jsonl" && ok "telegram: token na URL e chat_id no corpo" || bad "telegram: formato"
grep -q '"priority":"high"' "$T/out.jsonl" && ok "ntfy: prioridade alta na falha" || bad "ntfy: prioridade"
grep -q 'FALHA: site' "$T/out.jsonl" && ok "texto cita o item que caiu (site)" || bad "texto do alerta"
grep -qF '\"status\":\"fail\"' "$T/out.jsonl" && ok "webhook JSON com status=fail" || bad "status do webhook"

echo "== continua fora: SUPRESSAO de repeticao"
before="$(total)"
run_check; run_check; run_check
[ "$(total)" = "$before" ] && ok "3 rodadas em falha: nenhum alerta novo" || bad "repetiu alerta ($before -> $(total))"

echo "== lembrete apos 6 h (simulado com MON_REMIND_SECS=1)"
sleep 2
env -i PATH="$PATH" HOME="$T" MON_ONLY=site,saude MON_SITE_URL="$B/login" MON_HEALTH_URL="$B/api/health" HEALTH_TOKEN=tok-teste \
  ALERT_WEBHOOK_URL="$B/hook" ENV_FILE=/nao/existe MON_STATE_DIR="$T/state" MON_LOG="$T/mon.log" MON_CONFIRM=2 MON_REMIND_SECS=1 bash "$HERE/check.sh"
grep -q 'AINDA EM FALHA' "$T/out.jsonl" && ok "lembrete 'AINDA EM FALHA' enviado" || bad "sem lembrete"

echo "== volta: alerta de recuperacao uma unica vez"
echo up > "$T/mode"
before="$(count 'RECUPEROU')"
run_check
after="$(count 'RECUPEROU')"
[ "$after" -gt "$before" ] && ok "alerta RECUPEROU enviado" || bad "sem alerta de recuperacao"
grep -qF '\"status\":\"ok\"' "$T/out.jsonl" && ok "webhook JSON com status=ok na recuperacao" || bad "status ok ausente"
t1="$(total)"; run_check; run_check
[ "$(total)" = "$t1" ] && ok "depois de recuperar: silencio" || bad "alertou de novo apos recuperar"

echo "== checagens novas (modo ruim): WhatsApp, IA, envios, caixa de entrada"
echo ruim > "$T/mode"
run_check; run_check
for k in whatsapp_desconectado envios_falhando ia_credito_chave webhooks_acumulando; do
  grep -q "FALHA: $k" "$T/out.jsonl" && ok "alerta de $k" || bad "faltou alerta de $k"
done
grep -q 'so contagem' "$T/out.jsonl" && ok "texto de WhatsApp informa que e so contagem" || bad "texto de WhatsApp"
if grep -Eq '[0-9]{10,}|@s\.whatsapp' "$T/out.jsonl"; then bad "alerta contem algo parecido com telefone"; else ok "nenhum numero de telefone nos alertas"; fi
echo up > "$T/mode"; run_check
grep -c 'RECUPEROU: ia_credito_chave' "$T/out.jsonl" | grep -q '^[1-9]' && ok "recuperacao das checagens novas" || bad "sem recuperacao das novas"

echo "== sem canal configurado: registra no log, nao quebra"
echo down > "$T/mode"
env -i PATH="$PATH" HOME="$T" MON_ONLY=site MON_SITE_URL="$B/login" ENV_FILE=/nao/existe MON_STATE_DIR="$T/state2" MON_LOG="$T/mon2.log" MON_CONFIRM=1 bash "$HERE/check.sh"
grep -q 'ALERTA SEM CANAL' "$T/mon2.log" && ok "sem canal: registrado no log" || bad "sem canal: nada no log"

echo "== ALERT_EMAIL_TO definido, mas Resend ainda nao configurado: explica no log, nao quebra"
env -i PATH="$PATH" HOME="$T" MON_ONLY=site MON_SITE_URL="$B/login" ENV_FILE=/nao/existe MON_STATE_DIR="$T/state4" MON_LOG="$T/mon4.log" MON_CONFIRM=1 ALERT_EMAIL_TO="dono@exemplo.invalid" bash "$HERE/check.sh"
grep -q 'e-mail NAO enviado: ALERT_EMAIL_TO definido' "$T/mon4.log" && ok "e-mail sem Resend: motivo registrado no log" || bad "e-mail sem Resend: nada no log"

echo "== --test-alert"
n0="$(total)"
env -i PATH="$PATH" HOME="$T" ALERT_NTFY_URL="$B/ntfy-topic" ALERT_WEBHOOK_URL="$B/hook" ENV_FILE=/nao/existe MON_LOG="$T/mon3.log" bash "$HERE/check.sh" --test-alert > /dev/null
[ "$(total)" -ge $((n0 + 2)) ] && ok "alerta de teste chega nos canais configurados" || bad "alerta de teste"

echo "== segredos fora do log"
if grep -q "tok-teste\|123:abc" "$T/mon.log" 2>/dev/null; then bad "log contem segredo"; else ok "log do monitor sem segredos"; fi

echo; [ "$fails" = 0 ] && echo "SELFTEST_MONITOR_HTTP_OK" || { echo "SELFTEST_MONITOR_HTTP_FALHOU ($fails)"; exit 1; }
