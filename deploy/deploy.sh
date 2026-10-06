#!/usr/bin/env bash
# Republicacao normal de codigo (dominio ja no ar). UMA conexao SSH (envio + disparo em segundo plano);
# depois acompanha so por https. NAO mexe no Zapfloo (remote.sh sem STOP_ZAPFLOO).
# O arquivo de ambiente do servidor NAO e enviado (e a fonte da verdade). Se algo falhar depois da troca, o servidor
# REVERTE sozinho para a versao anterior (DEPLOY_RESULT=fail_rolled_back em deploy/last-deploy.log; veja com status.sh).
# Uso (Git Bash): bash deploy/deploy.sh      (configuracao: deploy/.deploy.env, ver deploy/deploy.env.example)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=_common.sh
. deploy/_common.sh
deploy_load_config || exit 1
deploy_check_clean_tree || exit 1
URL="https://$DOMAIN/login"

# Impressao digital do /login atual (antes do rebuild), para detectar a troca do build.
fp() { curl -s -m 10 "$URL" 2>/dev/null | grep -o '/_next/static/[^"]*' | sort -u | sha256sum | cut -c1-16; }
FP0="$(fp || true)"

# Hash do commit enviado (vira /opt/pearchat/.deploy-commit; lido pelo backup, por /api/health e pela verificacao pos-troca).
(git rev-parse HEAD 2>/dev/null || echo desconhecido) > .deploy-commit
echo "==> Enviando codigo e disparando build na VPS (1 conexao SSH)"
deploy_upload_and_run '(setsid nohup bash deploy/remote.sh > /dev/null 2>&1 < /dev/null &); echo UPLOAD_OK'

echo "==> Acompanhando pela web (sem SSH): $URL a cada 15s, ate 25 min"
START=$SECONDS; LIMIT=1500; saw_down=0; last=000
while [ $((SECONDS-START)) -lt $LIMIT ]; do
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL" || true)"
  last="$code"
  echo "[$((SECONDS-START))s] HTTP $code"
  if [ "$code" != 200 ]; then saw_down=1
  else
    now="$(fp || true)"
    if [ "$saw_down" = 1 ] || { [ -n "$FP0" ] && [ -n "$now" ] && [ "$now" != "$FP0" ]; }; then echo SITE_UP; exit 0; fi
  fi
  sleep 15
done
if [ "$last" = 200 ]; then
  echo "SITE_UP (200, mas a troca do build nao foi confirmada: o build pode ter falhado, o ambiente do servidor pode ter sido recusado pelo guarda, ou a versao foi revertida)"
  echo "Confirme com: bash deploy/status.sh   (1 conexao SSH; mostra DEPLOY_RESULT no fim do log)"
  exit 0
fi
echo SITE_TIMEOUT
exit 1
