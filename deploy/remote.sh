#!/usr/bin/env bash
# Roda NA VPS, em /opt/pearchat, disparado em segundo plano por deploy.sh / deploy-domain.sh.
# STOP_ZAPFLOO=1 (so o deploy-domain.sh) -> antes de tudo, para o Zapfloo e libera as portas 80/443 (zapfloo-stop.sh).
# Mexe apenas no projeto compose "pearchat". Log (sem segredos): deploy/last-deploy.log
cd /opt/pearchat || exit 1
LOG=/opt/pearchat/deploy/last-deploy.log
: > "$LOG"
exec >> "$LOG" 2>&1
C="docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production"
DOMAIN=pearchat.online
CADDY=pearchat-caddy-1
APP=pearchat-app-1
RESULT=ok

final() {
  echo "--- docker ps -a"
  docker ps -a --format 'table {{.Names}}\t{{.Status}}'
  echo "--- df -h /"
  df -h /
  echo "[$(date -u +%FT%TZ)] fim"
  echo "DEPLOY_RESULT=$RESULT"
  exit 0
}

echo "[$(date -u +%FT%TZ)] inicio (STOP_ZAPFLOO=${STOP_ZAPFLOO:-0})"
chmod 600 deploy/.env.production

# (a) Aposentar o Zapfloo (so no deploy-domain)
if [ "${STOP_ZAPFLOO:-0}" = 1 ]; then
  echo "--- zapfloo-stop.sh"
  ZOUT="$(bash deploy/zapfloo-stop.sh 2>&1)"
  printf '%s\n' "$ZOUT"
  if ! printf '%s\n' "$ZOUT" | grep -q '^ZAPFLOO_STOP_RESULT=ok'; then
    echo "--- portas 80/443 NAO ficaram livres (ou o Zapfloo nao parou): NAO subo o Caddy novo; subindo so o app"
    $C up -d --build app evolution evolution-db evolution-redis 2>&1 | tail -n 40
    echo "(app em 127.0.0.1:${PEARCHAT_PORT:-8088} na VPS; sem Caddy o site nao esta publico)"
    RESULT=fail_zapfloo_ports
    final
  fi
fi

# (b) Sobe tudo (inclui o caddy)
echo "--- compose up --build (todos os servicos)"
$C up -d --build 2>&1 | tail -n 60
[ "${PIPESTATUS[0]}" = 0 ] || RESULT=fail_compose_up

# (c) Espera o app saudavel
echo "--- aguardando healthcheck do app (ate 10 min)"
st=starting
for i in $(seq 1 120); do
  st="$(docker inspect -f '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo missing)"
  [ "$st" = healthy ] && break
  sleep 5
done
echo "app health: $st"
if [ "$st" != healthy ]; then
  [ "$RESULT" = ok ] && RESULT=fail_app_unhealthy
  echo "--- ultimas 60 linhas do app"
  docker logs --tail 60 "$APP" 2>&1 | sed -E 's#(postgres(ql)?://)[^[:space:]]+#\1***#g; s#(apikey|key|secret|token|password)=[^[:space:]&]+#\1=***#Ig' | cut -c1-300
else
  # (d) Migracoes
  echo "--- prisma migrate deploy"
  $C exec -T app npx prisma migrate deploy 2>&1 | tail -n 10
  [ "${PIPESTATUS[0]}" = 0 ] || [ "$RESULT" != ok ] || RESULT=fail_migrate
fi

# (e) Espera ate 3 min o Caddy obter o certificado
echo "--- aguardando Caddy / certificado de $DOMAIN (ate 3 min)"
cert=0
for i in $(seq 1 36); do
  cst="$(docker inspect -f '{{.State.Status}}' "$CADDY" 2>/dev/null || echo missing)"
  if [ "$cst" = running ]; then
    if docker logs "$CADDY" 2>&1 | grep 'certificate obtained successfully' | grep -q "$DOMAIN"; then cert=1; echo "certificado obtido (log do caddy)"; break; fi
    code="$(curl -sk -m 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/login" -o /dev/null -w '%{http_code}' || true)"
    if [ "$code" = 200 ]; then cert=1; echo "https local respondeu 200"; break; fi
  fi
  sleep 5
done
cst="$(docker inspect -f '{{.State.Status}}' "$CADDY" 2>/dev/null || echo missing)"
echo "caddy: $cst"
if [ "$cst" != running ]; then
  # (f) o Caddy do Zapfloo nao e alternativa (o app dele esta parado): apenas registrar
  [ "$RESULT" = ok ] && RESULT=fail_caddy_not_running
  echo "--- ultimas 40 linhas do caddy"
  docker logs --tail 40 "$CADDY" 2>&1 | cut -c1-300
elif [ "$cert" != 1 ]; then
  [ "$RESULT" = ok ] && RESULT=fail_cert_timeout
  echo "--- ultimas 40 linhas do caddy"
  docker logs --tail 40 "$CADDY" 2>&1 | cut -c1-300
fi
final
