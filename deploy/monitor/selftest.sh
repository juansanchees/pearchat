#!/usr/bin/env bash
# Autoteste local do estado/transicoes do monitor (sem Docker, sem rede).
#   bash deploy/monitor/selftest.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "  ok: $1"; }
bad() { echo "  FALHOU: $1"; fails=$((fails + 1)); }
eq() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (esperado '$2', veio '$1')"; }
# roda uma rodada: $1 = epoch, resto = pares nome=ok|fail
round() {
  NOW="$1"; shift; MSGS=(); FAILING=()
  local kv
  for kv in "$@"; do mon_record "${kv%%=*}" "${kv#*=}" "detalhe de ${kv%%=*}"; done
}
H=3600; t0=1800000000

echo "== mon_decide"
eq "$(mon_decide ok 0 100 fail)" alert_fail "ok->falha avisa"
eq "$(mon_decide fail 100 200 fail)" none "falha continua: silencio"
eq "$(mon_decide fail 100 $((100 + 6 * H)) fail)" remind "lembra apos 6 h"
eq "$(mon_decide fail 100 $((100 + 6 * H - 1)) fail)" none "ainda nao deu 6 h"
eq "$(mon_decide fail 100 200 ok)" alert_ok "falha->ok avisa"
eq "$(mon_decide ok 0 200 ok)" none "ok continua: silencio"

echo "== sequencia com confirmacao de 2 falhas seguidas"
MON_CONFIRM=2
mon_state_load "$T/nao-existe.json"
round "$t0" site=ok;                          eq "${#MSGS[@]}" 0 "1a rodada ok: sem alerta"
round $((t0 + 300)) site=fail;                eq "${#MSGS[@]}" 0 "1a falha isolada: sem alerta (ruido)"
round $((t0 + 600)) site=fail;                eq "${#MSGS[@]}" 1 "2a falha seguida: alerta"; echo "    -> ${MSGS[0]}"
round $((t0 + 900)) site=fail;                eq "${#MSGS[@]}" 0 "falha continua: silencio"
round $((t0 + 600 + 6 * H)) site=fail;        eq "${#MSGS[@]}" 1 "lembrete apos 6 h"; echo "    -> ${MSGS[0]}"
round $((t0 + 600 + 6 * H + 300)) site=ok;    eq "${#MSGS[@]}" 1 "recuperou: alerta"; echo "    -> ${MSGS[0]}"
round $((t0 + 600 + 6 * H + 600)) site=ok;    eq "${#MSGS[@]}" 0 "ok de novo: silencio"
round $((t0 + 600 + 6 * H + 900)) site=fail;  eq "${#MSGS[@]}" 0 "falha isolada depois de recuperar: sem alerta"
round $((t0 + 600 + 6 * H + 1200)) site=ok;   eq "${#MSGS[@]}" 0 "falha isolada some sozinha: sem alerta"

echo "== persistencia do estado em arquivo"
NOW=$t0; MSGS=(); FAILING=()
mon_state_load "$T/s.json"
mon_record disco fail "disco 90%" 1
mon_record "container:pearchat-app-1" ok ""
mon_state_save "$T/s.json"
grep -q '"disco": {"s":"fail"' "$T/s.json" && ok "estado gravado" || bad "estado nao gravado"
if command -v node >/dev/null 2>&1; then node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$T/s.json" && ok "state.json e JSON valido" || bad "JSON invalido"; fi
mon_state_load "$T/s.json"
eq "${ST_S[disco]}/${ST_AVISO[disco]}" "fail/$t0" "estado recarregado (falha + instante do aviso)"
NOW=$((t0 + 300)); MSGS=(); mon_record disco fail "disco 90%" 1
eq "${#MSGS[@]}" 0 "apos recarregar, a falha continua em silencio (nao reavisa)"
NOW=$((t0 + 600)); MSGS=(); mon_record disco ok ""
eq "${#MSGS[@]}" 1 "recuperacao apos recarregar avisa"
printf 'lixo\n{"x": 1}\n' > "$T/ruim.json"; mon_state_load "$T/ruim.json"; eq "${#ST_S[@]}" 0 "arquivo corrompido: comeca vazio"

echo "== mon_jget / mon_json_str"
J='{"ok":true,"db":"ok","versao":"abc123","uptimeSeg":55,"agendador":{"ativo":true,"ultimoTick":"2026-10-04T10:00:00.000Z","idadeTickSeg":3},"jobsPresos":{"ia":1,"followUp":0,"soma":1,"acimaDeMin":10}}'
eq "$(mon_jget "$J" ok)" true "ok"; eq "$(mon_jget "$J" idadeTickSeg)" 3 "idadeTickSeg"; eq "$(mon_jget "$J" soma)" 1 "soma"; eq "$(mon_jget "$J" db)" ok "db"
eq "$(mon_json_str 'a"b
c')" 'a\"b\nc' "escape JSON com quebra de linha"

echo; [ "$fails" = 0 ] && echo "SELFTEST_MONITOR_OK" || { echo "SELFTEST_MONITOR_FALHOU ($fails)"; exit 1; }
