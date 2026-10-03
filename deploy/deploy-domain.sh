#!/usr/bin/env bash
# Coloca o PearChat em https://pearchat.online com Caddy PROPRIO e aposenta (PARA) o Zapfloo.
# UMA conexao SSH (a VPS bloqueia conexoes seguidas por ~1h): envia codigo + deploy/.env.production + Caddyfile
# + zapfloo-stop.sh, extrai e dispara deploy/remote.sh (STOP_ZAPFLOO=1) em segundo plano; depois acompanha so por curl.
# Uso (Git Bash): bash deploy/deploy-domain.sh
# Pre-requisito: PUBLIC_URL=https://pearchat.online node deploy/gen-env.mjs (o .env.production ja deve ter as URLs https).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${PEARCHAT_HOST:-82.25.79.194}"
KEY="${PEARCHAT_KEY:-$HOME/.ssh/pearchat_vps}"
DOMAIN="${PEARCHAT_DOMAIN:-pearchat.online}"
OUT="${TMPDIR:-/tmp}/pearchat-domain-ssh.out"

[ -f deploy/.env.production ] || { echo "falta deploy/.env.production (rode: PUBLIC_URL=https://$DOMAIN node deploy/gen-env.mjs)"; exit 1; }
grep -q "^AUTH_URL='https://$DOMAIN'" deploy/.env.production || { echo "AUTH_URL do .env.production nao e https://$DOMAIN; rode: PUBLIC_URL=https://$DOMAIN node deploy/gen-env.mjs"; exit 1; }
[ -f deploy/Caddyfile ] && [ -f deploy/zapfloo-stop.sh ] || { echo "faltam deploy/Caddyfile ou deploy/zapfloo-stop.sh"; exit 1; }

REMOTE_CMD="mkdir -p /opt/pearchat && cd /opt/pearchat && rm -rf src prisma docker public && tar xzf - -C /opt/pearchat || { echo UPLOAD_FALHOU; exit 1; }; echo UPLOAD_OK; (STOP_ZAPFLOO=1 setsid nohup bash deploy/remote.sh > /dev/null 2>&1 < /dev/null &); echo REMOTE_DISPARADO"

echo "==> Conexao SSH unica: upload + disparo de remote.sh (para o Zapfloo, sobe Caddy + app) em segundo plano"
tar czf - \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env' --exclude='.env.local' \
  --exclude='.env.example' --exclude=docs --exclude='*.log' --exclude='*.tsbuildinfo' \
  --exclude=next-env.d.ts --exclude=.claude . \
| ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 "root@$HOST" "$REMOTE_CMD" | tee "$OUT"

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
curl -sI -m 15 "https://$DOMAIN/login" | head -12 || true
echo "==> http://$DOMAIN/login (deve redirecionar para https)"
curl -s -o /dev/null -m 15 -w 'HTTP %{http_code} -> %{redirect_url}\n' "http://$DOMAIN/login" || true
echo "==> https://www.$DOMAIN/login (deve redirecionar para https://$DOMAIN/login)"
curl -s -o /dev/null -m 15 -w 'HTTP %{http_code} -> %{redirect_url}\n' "https://www.$DOMAIN/login" || true

if [ "$UP" = 1 ]; then echo DOMAIN_UP; exit 0; fi
echo DOMAIN_TIMEOUT
echo "(veja o motivo com: bash deploy/status.sh  -- 1 conexao SSH, de preferencia ~1h depois)"
exit 1
