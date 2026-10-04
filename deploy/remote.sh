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

# (a2) Migracoes ANTES de trocar o app: constroi a imagem nova e aplica `prisma migrate deploy` com ela enquanto o
# app ANTIGO continua no ar. As migracoes sao aditivas (tabelas/colunas novas, nuláveis ou com DEFAULT), entao o app
# antigo segue funcionando durante a aplicacao e o app novo ja nasce com o banco pronto (sem janela de erro).
# Se a migracao falhar, NAO troca o app (o antigo segue servindo) e o deploy termina com fail_migrate_pre.
# (A etapa (d) abaixo continua rodando e vira um no-op idempotente.)
echo "--- build da imagem do app (antes de trocar o app em producao)"
$C build app 2>&1 | tail -n 15
if [ "${PIPESTATUS[0]}" = 0 ]; then
  echo "--- prisma migrate deploy (container descartavel, imagem nova, app antigo ainda no ar)"
  $C run --rm --no-deps -T app npx prisma migrate deploy 2>&1 | tail -n 15
  if [ "${PIPESTATUS[0]}" != 0 ]; then
    RESULT=fail_migrate_pre
    final
  fi
else
  echo "(build falhou: segue para o compose up, que reporta o erro)"
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

# (g) Pos-deploy (NAO bloqueante: nada aqui muda DEPLOY_RESULT). So depois de um deploy bem-sucedido.
if [ "$RESULT" = ok ]; then
  # Limpeza de sobras de build: so imagens SEM etiqueta e cache de build com mais de 48 h (nunca -a, nunca volumes).
  echo "--- limpeza de sobras de build"
  L0="$(df -Pk / | awk 'NR==2{print $4}')"
  docker image prune -f 2>&1 | tail -n 2
  docker builder prune -f --filter until=48h 2>&1 | tail -n 2
  L1="$(df -Pk / | awk 'NR==2{print $4}')"
  echo "espaco livre em /: antes $((L0 / 1024)) MB, depois $((L1 / 1024)) MB"
  # Instalacao idempotente do backup (sem rodar backup agora; o cron roda) e do monitor.
  echo "--- instalando backup diario (nao bloqueante)"
  bash deploy/backup/install.sh --no-first-run 2>&1 | tail -n 15
  [ "${PIPESTATUS[0]}" = 0 ] || echo "(AVISO: install do backup falhou; deploy segue ok)"
  echo "--- instalando monitor (nao bloqueante)"
  bash deploy/monitor/install.sh 2>&1 | tail -n 15
  [ "${PIPESTATUS[0]}" = 0 ] || echo "(AVISO: install do monitor falhou; deploy segue ok)"
fi
final
