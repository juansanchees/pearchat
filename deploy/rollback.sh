#!/usr/bin/env bash
# Reversao MANUAL para a versao anterior (imagem pearchat-app:previous + compose/Caddyfile anteriores).
# UMA conexao SSH, em segundo plano como o deploy; depois acompanha so por https.
# O deploy ja reverte SOZINHO quando a verificacao pos-troca falha; use isto quando o problema aparecer depois.
# Nao desfaz migracoes de banco (sao aditivas; o app anterior continua funcionando com elas).
# Resultado no servidor: deploy/last-deploy.log (ROLLBACK_RESULT=ok|fail|sem_imagem_anterior), ver com: bash deploy/status.sh
# Uso (Git Bash): bash deploy/rollback.sh      (configuracao: deploy/.deploy.env)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=_common.sh
. deploy/_common.sh
deploy_load_config || exit 1
URL="https://$DOMAIN/login"

echo "==> Disparando a reversao na VPS (1 conexao SSH)"
ssh "${SSH_BASE[@]}" "$SSH_USER@$HOST" \
  'cd /opt/pearchat && [ -f deploy/remote-rollback.sh ] || { echo SEM_SCRIPT; exit 1; }; (setsid nohup bash deploy/remote-rollback.sh > /dev/null 2>&1 < /dev/null &); echo ROLLBACK_DISPARADO'

echo "==> Acompanhando pela web (sem SSH): $URL a cada 15s, ate 10 min"
START=$SECONDS; LIMIT=600; saw_down=0
while [ $((SECONDS-START)) -lt $LIMIT ]; do
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL" || true)"
  echo "[$((SECONDS-START))s] HTTP $code"
  if [ "$code" != 200 ]; then saw_down=1
  elif [ "$saw_down" = 1 ] || [ $((SECONDS-START)) -ge 120 ]; then echo "SITE_UP (confirme o resultado com: bash deploy/status.sh)"; exit 0; fi
  sleep 15
done
echo "SITE_UP/TIMEOUT: confirme com: bash deploy/status.sh"
exit 0
