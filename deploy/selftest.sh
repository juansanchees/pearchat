#!/usr/bin/env bash
# Autoteste local dos scripts de publicacao (sem Docker, sem rede, sem SSH): env-sync.sh nao altera valores existentes,
# so acrescenta o que falta, faz copia datada com permissao 600 e e idempotente.
#   bash deploy/selftest.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "  ok: $1"; }
bad() { echo "  FALHOU: $1"; fails=$((fails + 1)); }

echo "== env-sync.sh"
cd "$T" || exit 1
printf "DATABASE_URL='postgresql://x'\nAUTH_SECRET='segredo-original'\nWA_MOCK='false'" > e.env   # sem quebra de linha no fim, de proposito
ENVF=./e.env DRY_RUN=1 bash "$HERE/env-sync.sh" > out1.txt 2>&1
grep -q 'simulacao' out1.txt && ok "simulacao lista o que acrescentaria" || bad "simulacao"
[ "$(ls e.env.bak-* 2>/dev/null | wc -l)" = 0 ] && ok "simulacao nao cria copia" || bad "simulacao criou copia"

ENVF=./e.env bash "$HERE/env-sync.sh" > out2.txt 2>&1
grep -q "^AUTH_SECRET='segredo-original'$" e.env && ok "valor existente intacto" || bad "valor existente alterado"
grep -q "^DATABASE_URL='postgresql://x'$" e.env && ok "DATABASE_URL intacta" || bad "DATABASE_URL alterada"
grep -q "^HEALTH_TOKEN='[A-Za-z0-9]\{30,\}'$" e.env && ok "HEALTH_TOKEN gerado (forte)" || bad "HEALTH_TOKEN"
grep -q "^NEXT_PUBLIC_WA_MOCK='false'$" e.env && ok "NEXT_PUBLIC_WA_MOCK=false acrescentado" || bad "NEXT_PUBLIC_WA_MOCK"
[ "$(grep -c '^WA_MOCK=' e.env)" = 1 ] && ok "WA_MOCK nao duplicado" || bad "WA_MOCK duplicado"
bak="$(ls e.env.bak-* 2>/dev/null | head -n1)"
[ -n "$bak" ] && ok "copia datada criada ($bak)" || bad "sem copia datada"
if [ -n "$bak" ]; then
  [ "$(grep -c '' "$bak")" = 3 ] && grep -q "segredo-original" "$bak" && ok "copia = arquivo original" || bad "copia diferente do original"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ok "permissao 600: nao verificavel no Windows (so no Linux/CI)" ;;
    *) perm="$(stat -c %a "$bak" 2>/dev/null || echo ?)"; if [ "$perm" = 600 ]; then ok "copia com permissao 600"; else bad "permissao da copia $perm"; fi ;;
  esac
fi
grep -q "HEALTH_TOKEN" out2.txt && ! grep -q "HEALTH_TOKEN='" out2.txt && ok "saida mostra so o NOME da chave" || bad "saida vaza valor"
before="$(cat e.env)"
ENVF=./e.env bash "$HERE/env-sync.sh" > out3.txt 2>&1
[ "$before" = "$(cat e.env)" ] && grep -q 'nada a acrescentar' out3.txt && ok "idempotente" || bad "nao idempotente"
printf "A='1'\n" > f.env
ENVF=./f.env bash "$HERE/env-sync.sh" > /dev/null 2>&1
HT1="$(grep '^HEALTH_TOKEN=' f.env)"
ENVF=./f.env bash "$HERE/env-sync.sh" > /dev/null 2>&1
[ "$HT1" = "$(grep '^HEALTH_TOKEN=' f.env)" ] && ok "HEALTH_TOKEN existente nunca e regerado" || bad "HEALTH_TOKEN regerado"
ENVF=./nao-existe.env bash "$HERE/env-sync.sh" > /dev/null 2>&1 && bad "arquivo inexistente deveria falhar" || ok "arquivo inexistente falha"

echo; [ "$fails" = 0 ] && echo "SELFTEST_DEPLOY_OK" || { echo "SELFTEST_DEPLOY_FALHOU ($fails)"; exit 1; }
