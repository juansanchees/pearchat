#!/usr/bin/env bash
# Roda NA VPS, em /opt/pearchat, disparado em segundo plano por deploy.sh / deploy-domain.sh.
# STOP_ZAPFLOO=1 (so o deploy-domain.sh) -> antes de tudo, para o Zapfloo e libera as portas 80/443 (zapfloo-stop.sh).
# Mexe apenas no projeto compose "pearchat". Log (sem segredos): deploy/last-deploy.log
#
# Ordem (cada etapa que falha ANTES da troca deixa o app antigo no ar):
#   0  arquivo de ambiente do SERVIDOR = fonte da verdade (env-sync.sh: so acrescenta chaves, com copia datada)
#   1  etiqueta a imagem em uso como pearchat-app:previous (base da reversao)
#   2  build da imagem nova; guarda de inicializacao valida o .env.production com a imagem nova; migracoes ADITIVAS
#   3  troca (compose up); espera healthy
#   4  verificacao pos-troca (health + versao + login/CSRF/sessao + Caddy + Evolution); se falhar, REVERTE sozinho
#   5  so se tudo ok: limpeza, instalacao do backup e do monitor
# MIGRACOES: a migracao N so pode ADICIONAR (tabela/coluna anulavel ou com DEFAULT, indice). Remover/renomear/NOT NULL
# so na migracao N+1, depois que o codigo N ja nao usa o item. Sem isso a reversao do app deixaria o banco incompativel.
cd /opt/pearchat || exit 1
LOG=/opt/pearchat/deploy/last-deploy.log
: > "$LOG"
exec >> "$LOG" 2>&1
HERE=/opt/pearchat/deploy
# shellcheck source=lib-remote.sh
. "$HERE/lib-remote.sh"
RESULT=ok
HAVE_PREV=0

final() {
  echo "--- docker ps -a"
  docker ps -a --format 'table {{.Names}}\t{{.Status}}'
  echo "--- df -h /"
  df -h /
  echo "[$(date -u +%FT%TZ)] fim"
  echo "DEPLOY_RESULT=$RESULT"
  exit 0
}

# Reverte (imagem + compose/Caddyfile anteriores) e registra o resultado. $1 = motivo.
rollback_now() {
  echo "--- REVERTENDO: $1"
  if [ "$HAVE_PREV" != 1 ]; then
    echo "(sem imagem anterior etiquetada: nao ha para onde voltar; primeiro deploy?)"
    return 1
  fi
  if ROLLBACK_FROM_DEPLOY=1 bash "$HERE/remote-rollback.sh"; then
    RESULT=fail_rolled_back
    echo "REVERSAO CONCLUIDA: o app anterior esta de volta (veja acima o motivo da falha)."
  else
    RESULT=fail_rollback_failed
    echo "REVERSAO FALHOU: o servico pode estar fora do ar. Rode: bash deploy/rollback.sh (ou veja docker ps/logs)."
  fi
  return 0
}

echo "[$(date -u +%FT%TZ)] inicio (STOP_ZAPFLOO=${STOP_ZAPFLOO:-0})"

# (0) Ambiente do servidor: fonte da verdade
if [ ! -f "$ENVF" ]; then
  echo "ERRO: $ENVF nao existe no servidor. Crie-o uma vez (ver docs/operacao/publicacao.md, 'Primeira instalacao'); o deploy nao o envia."
  RESULT=fail_no_env
  final
fi
chmod 600 "$ENVF"
echo "--- env-sync (so acrescenta chaves que faltam; nao altera valores existentes)"
bash "$HERE/env-sync.sh" 2>&1 | tail -n 15

DOMAIN="$(deploy_domain)"

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

# (1) Base da reversao: etiqueta a imagem que esta RODANDO agora (antes de qualquer build) como pearchat-app:previous.
PREV_ID="$(docker inspect -f '{{.Image}}' "$APP" 2>/dev/null || true)"
[ -n "$PREV_ID" ] || PREV_ID="$(docker image inspect -f '{{.Id}}' pearchat-app:latest 2>/dev/null || true)"
if [ -n "$PREV_ID" ] && docker tag "$PREV_ID" pearchat-app:previous 2>/dev/null; then
  HAVE_PREV=1
  echo "imagem em uso etiquetada como pearchat-app:previous ($(printf '%s' "$PREV_ID" | cut -c1-19))"
else
  echo "(nenhuma imagem anterior para etiquetar: primeiro deploy)"
fi

# (2) Build da imagem nova ANTES de trocar o app (o app antigo continua no ar durante o build).
echo "--- build da imagem do app (antes de trocar o app em producao)"
$C build app 2>&1 | tail -n 15
if [ "${PIPESTATUS[0]}" != 0 ]; then
  echo "BUILD FALHOU: nada foi trocado; o app anterior segue no ar."
  RESULT=fail_build
  final
fi
TAG12="$(tr -d '[:space:]' < .deploy-commit 2>/dev/null | cut -c1-12)"
if [[ "$TAG12" =~ ^[0-9a-f]{12}$ ]]; then docker tag pearchat-app:latest "pearchat-app:$TAG12" 2>/dev/null && echo "imagem etiquetada pearchat-app:$TAG12"; fi

# (2b) Guarda de inicializacao: valida o .env.production do servidor com a MESMA regra que o app usa para subir.
echo "--- guarda de inicializacao: validando $ENVF com a imagem nova"
$C run --rm --no-deps -T app node_modules/.bin/tsx scripts/check-env.ts 2>&1 | tail -n 30
if [ "${PIPESTATUS[0]}" != 0 ]; then
  echo "O app NOVO recusaria subir com este ambiente. Nada foi trocado; o app anterior segue no ar. Corrija o arquivo $ENVF no servidor."
  RESULT=fail_env_invalid
  final
fi

# (2b') Caddyfile novo valido? (com a MESMA imagem do Caddy que roda; sem rede, sem tocar no Caddy em uso). Invalido = nada e trocado.
CIMG="$(envval CADDY_IMAGE)"; CIMG="${CIMG:-caddy:2-alpine}"
echo "--- validando o Caddyfile novo (caddy validate, imagem $CIMG)"
docker run --rm --network none -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" "$CIMG" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -n 15
if [ "${PIPESTATUS[0]}" != 0 ]; then
  echo "O Caddyfile novo e INVALIDO. Nada foi trocado; o app e o Caddy anteriores seguem no ar."
  RESULT=fail_caddyfile_invalid
  final
fi

# (2c) Migracoes ANTES da troca, em container descartavel (imagem nova). Aditivas: o app antigo segue funcionando.
echo "--- prisma migrate deploy (container descartavel, imagem nova, app antigo ainda no ar)"
migrate_run run 2>&1 | tail -n 15
if [ "${PIPESTATUS[0]}" != 0 ]; then
  RESULT=fail_migrate_pre
  final
fi

# (3) Troca: sobe tudo (inclui o caddy). Servicos sem mudanca de configuracao nao sao recriados.
echo "--- compose up (todos os servicos)"
$C up -d --build 2>&1 | tail -n 60
[ "${PIPESTATUS[0]}" = 0 ] || RESULT=fail_compose_up

echo "--- aguardando healthcheck do app (ate 10 min)"
if ! wait_app_healthy 120; then
  [ "$RESULT" = ok ] && RESULT=fail_app_unhealthy
  echo "--- ultimas 60 linhas do app"
  docker logs --tail 60 "$APP" 2>&1 | sed -E 's#(postgres(ql)?://)[^[:space:]]+#\1***#g; s#(apikey|key|secret|token|password)=[^[:space:]&]+#\1=***#Ig' | cut -c1-300
  rollback_now "app nao ficou saudavel"
  final
fi

# Migracoes: no-op idempotente (as de verdade ja rodaram em 2c).
echo "--- prisma migrate deploy (confirmacao)"
migrate_run exec 2>&1 | tail -n 10
[ "${PIPESTATUS[0]}" = 0 ] || [ "$RESULT" != ok ] || RESULT=fail_migrate

# (e) Espera ate 3 min o Caddy obter o certificado (ou o https local responder)
echo "--- aguardando Caddy / certificado de $DOMAIN (ate 3 min)"
cert=0
for _ in $(seq 1 36); do
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
  [ "$RESULT" = ok ] && RESULT=fail_caddy_not_running
  echo "--- ultimas 40 linhas do caddy"
  docker logs --tail 40 "$CADDY" 2>&1 | cut -c1-300
elif [ "$cert" != 1 ]; then
  [ "$RESULT" = ok ] && RESULT=fail_cert_timeout
  echo "--- ultimas 40 linhas do caddy"
  docker logs --tail 40 "$CADDY" 2>&1 | cut -c1-300
fi

# (4) Verificacao pos-troca. Falha de app, banco, login, Caddy ou Evolution => reverte sozinho.
# (Demora de certificado nao reverte: voltar a versao nao a resolve.)
if [ "$RESULT" = ok ] || [ "$RESULT" = fail_cert_timeout ] || [ "$RESULT" = fail_migrate ]; then
  echo "--- verificacao pos-troca (health, versao, login/CSRF/sessao, Caddy, Evolution)"
  if ! smoke_check 150; then
    rollback_now "verificacao pos-troca falhou"
    final
  fi
elif [ "$RESULT" = fail_caddy_not_running ] || [ "$RESULT" = fail_compose_up ]; then
  rollback_now "$RESULT"
  final
fi

# (5) Pos-deploy (NAO bloqueante: nada aqui muda DEPLOY_RESULT). So depois de um deploy bem-sucedido.
if [ "$RESULT" = ok ]; then
  # Limpeza de sobras de build: so imagens SEM etiqueta e cache de build com mais de 48 h (nunca -a, nunca volumes).
  # As etiquetas pearchat-app:previous e pearchat-app:<commit> NAO sao "sem etiqueta": ficam. Mantem so os 3 ultimos <commit>.
  echo "--- limpeza de sobras de build"
  L0="$(df -Pk / | awk 'NR==2{print $4}')"
  docker image ls pearchat-app --format '{{.Tag}} {{.CreatedAt}}' 2>/dev/null | awk '$1 ~ /^[0-9a-f]{12}$/ {print $1}' | tail -n +4 | while IFS= read -r t; do
    docker rmi "pearchat-app:$t" >/dev/null 2>&1 && echo "removida etiqueta antiga pearchat-app:$t"
  done
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
