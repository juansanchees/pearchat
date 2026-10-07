#!/usr/bin/env bash
# Coloca o PearChat em https://<dominio> com Caddy PROPRIO e aposenta (PARA) o Zapfloo.
# UMA conexao SSH (a VPS bloqueia conexoes seguidas por ~1h): envia codigo + Caddyfile + zapfloo-stop.sh, extrai e
# dispara deploy/remote.sh (STOP_ZAPFLOO=1) em segundo plano; depois acompanha so por curl.
# Uso (Git Bash): bash deploy/deploy-domain.sh      (configuracao: deploy/.deploy.env, ver deploy/deploy.env.example)
# Pre-requisito: o arquivo de ambiente JA EXISTE no servidor (/opt/pearchat/deploy/.env.production) com AUTH_URL=https://<dominio>.
# Ele nunca e enviado por este script (ver docs/operacao/publicacao.md, "Primeira instalacao").
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=_common.sh
. deploy/_common.sh
deploy_load_config || exit 1
deploy_check_clean_tree || exit 1
OUT="${TMPDIR:-/tmp}/pearchat-domain-ssh.out"

[ -f deploy/Caddyfile ] && [ -f deploy/zapfloo-stop.sh ] || { echo "faltam deploy/Caddyfile ou deploy/zapfloo-stop.sh"; exit 1; }

# Hash do commit enviado (vira /opt/pearchat/.deploy-commit; lido pelo backup e por /api/health).
(git rev-parse HEAD 2>/dev/null || echo desconhecido) > .deploy-commit
echo "==> Conexao SSH unica: upload + disparo de remote.sh (para o Zapfloo, sobe Caddy + app) em segundo plano"
deploy_upload_and_run 'echo UPLOAD_OK; (STOP_ZAPFLOO=1 setsid nohup bash deploy/remote.sh > /dev/null 2>&1 < /dev/null &); echo REMOTE_DISPARADO' | tee "$OUT"

if ! grep -q '^REMOTE_DISPARADO' "$OUT"; then
  echo "Envio falhou ou remote.sh nao foi disparado. Nada foi alterado na VPS alem do upload."
  echo DOMAIN_ABORTED
  exit 1
fi

echo "==> Sem SSH daqui em diante. Acompanhando https://$DOMAIN/login a cada 30s, ate 25 min"
START=$SECONDS; LIMIT=1500; UP=0
while [ $((SECONDS-START)) -lt $LIMIT ]; do
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$DOMAIN/login" || true)"
  echo "[$((SECONDS-START))s] https HTTP $code"
  if [ "$code" = 200 ]; then UP=1; break; fi
  sleep 30
done

echo "==> curl -sI https://$DOMAIN/login"
curl -sI -m 15 "https://$DOMAIN/login" | head -14 || true
echo "==> http://$DOMAIN/login (deve redirecionar para https)"
curl -s -o /dev/null -m 15 -w 'HTTP %{http_code} -> %{redirect_url}\n' "http://$DOMAIN/login" || true
echo "==> https://www.$DOMAIN/login (deve redirecionar para https://$DOMAIN/login)"
curl -s -o /dev/null -m 15 -w 'HTTP %{http_code} -> %{redirect_url}\n' "https://www.$DOMAIN/login" || true

if [ "$UP" = 1 ]; then echo DOMAIN_UP; exit 0; fi
echo DOMAIN_TIMEOUT
echo "(veja o motivo com: bash deploy/status.sh  -- 1 conexao SSH, de preferencia ~1h depois)"
exit 1
