#!/usr/bin/env bash
# Republicacao normal de codigo (dominio ja no ar). UMA conexao SSH (envio + disparo em segundo plano);
# depois acompanha so por https. NAO mexe no Zapfloo (remote.sh sem STOP_ZAPFLOO).
# Uso (Git Bash): bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${PEARCHAT_HOST:-82.25.79.194}"
KEY="${PEARCHAT_KEY:-$HOME/.ssh/pearchat_vps}"
DOMAIN="${PEARCHAT_DOMAIN:-pearchat.online}"
URL="https://$DOMAIN/login"

[ -f deploy/.env.production ] || node deploy/gen-env.mjs

# Impressao digital do /login atual (antes do rebuild), para detectar a troca do build.
fp() { curl -s -m 10 "$URL" 2>/dev/null | grep -o '/_next/static/[^"]*' | sort -u | sha256sum | cut -c1-16; }
FP0="$(fp || true)"

# Hash do commit enviado (vira /opt/pearchat/.deploy-commit; lido pelo backup e por /api/health).
(git rev-parse HEAD 2>/dev/null || echo desconhecido) > .deploy-commit
echo "==> Enviando codigo e disparando build na VPS (1 conexao SSH)"
tar czf - \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env' --exclude='.env.local' \
  --exclude='.env.example' --exclude=docs --exclude='*.log' --exclude='*.tsbuildinfo' \
  --exclude=next-env.d.ts --exclude=.claude . \
| ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 "root@$HOST" \
  'mkdir -p /opt/pearchat && cd /opt/pearchat && rm -rf src prisma docker public && tar xzf - -C /opt/pearchat || { echo UPLOAD_FALHOU; exit 1; }; (setsid nohup bash deploy/remote.sh > /dev/null 2>&1 < /dev/null &); echo UPLOAD_OK'

echo "==> Acompanhando pela web (sem SSH): $URL a cada 15s, ate 20 min"
START=$SECONDS; LIMIT=1200; saw_down=0; last=000
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
if [ "$last" = 200 ]; then echo "SITE_UP (200, mas a troca do build nao foi confirmada; confira com: bash deploy/status.sh)"; exit 0; fi
echo SITE_TIMEOUT
exit 1
