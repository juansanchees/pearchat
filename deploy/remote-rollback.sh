#!/usr/bin/env bash
# Roda NA VPS, em /opt/pearchat. Volta o app para a imagem etiquetada pearchat-app:previous e restaura o compose e o
# Caddyfile anteriores (guardados como *.previous pelo deploy), recriando so o que mudou.
#   - chamado por remote.sh quando a verificacao pos-troca falha (ROLLBACK_FROM_DEPLOY=1: grava no log do deploy);
#   - chamado por deploy/rollback.sh (computador do dono), em segundo plano, para reversao manual.
# Log: deploy/last-deploy.log (a reversao manual ACRESCENTA ao fim). Termina com ROLLBACK_RESULT=ok|fail|sem_imagem_anterior.
# ATENCAO: reverter NAO desfaz migracoes de banco. Elas sao aditivas (tabela/coluna nova), entao o app antigo continua
# funcionando; por isso a regra "migracao so adiciona" no remote.sh.
cd /opt/pearchat || exit 1
HERE=/opt/pearchat/deploy
LOG=$HERE/last-deploy.log
if [ "${ROLLBACK_FROM_DEPLOY:-0}" != 1 ]; then
  exec >> "$LOG" 2>&1
  echo
  echo "[$(date -u +%FT%TZ)] === REVERSAO MANUAL iniciada"
fi
# shellcheck source=lib-remote.sh
. "$HERE/lib-remote.sh"

finish() { echo "ROLLBACK_RESULT=$1"; [ "$1" = ok ] && exit 0; exit 1; }

if ! docker image inspect pearchat-app:previous >/dev/null 2>&1; then
  echo "Nao existe a imagem pearchat-app:previous (nenhum deploy anterior registrado nesta VPS)."
  finish sem_imagem_anterior
fi

# 1) Restaura compose e Caddyfile anteriores (se o deploy os guardou). O que estava em uso fica como *.failed.
for f in docker-compose.prod.yml Caddyfile; do
  if [ -f "$HERE/$f.previous" ]; then
    if ! cmp -s "$HERE/$f" "$HERE/$f.previous"; then
      cp -p "$HERE/$f" "$HERE/$f.failed" 2>/dev/null || true
      cp -p "$HERE/$f.previous" "$HERE/$f"
      echo "restaurado deploy/$f anterior (o que falhou ficou em deploy/$f.failed)"
    fi
  fi
done

# 2) Move a etiqueta "latest" de volta para a imagem anterior e recria o que mudou, sem reconstruir nada.
docker tag pearchat-app:previous pearchat-app:latest || finish fail
echo "--- compose up --no-build com a imagem anterior"
$C up -d --no-build 2>&1 | tail -n 40
[ "${PIPESTATUS[0]}" = 0 ] || { echo "compose up falhou na reversao"; finish fail; }

# 3) Confere que voltou a funcionar (mesma verificacao do deploy, sem exigir a versao do commit novo: o arquivo
#    .deploy-commit ainda tem o hash do deploy que falhou).
echo "--- aguardando healthcheck do app (ate 5 min)"
wait_app_healthy 60 || { echo "o app anterior tambem nao ficou saudavel; veja: docker logs --tail 100 $APP"; finish fail; }
if SMOKE_SKIP_VERSION=1 smoke_check 120; then
  echo "App anterior de volta e verificado."
  finish ok
fi
echo "O app anterior subiu, mas a verificacao falhou (veja acima)."
finish fail
