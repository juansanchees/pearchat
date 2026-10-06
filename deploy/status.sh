#!/usr/bin/env bash
# Diagnostico: UMA conexao SSH, somente leitura (log do ultimo deploy, imagens etiquetadas, docker ps, disco).
# Uso: bash deploy/status.sh      (configuracao: deploy/.deploy.env, ver deploy/deploy.env.example)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=_common.sh
. deploy/_common.sh
deploy_load_config || exit 1
ssh "${SSH_BASE[@]}" "$SSH_USER@$HOST" '
cd /opt/pearchat || exit 1
echo "=== deploy/last-deploy.log (ultimas 100 linhas)"; tail -100 deploy/last-deploy.log
if [ -f deploy/zapfloo-inventory.txt ]; then echo; echo "=== deploy/zapfloo-inventory.txt"; cat deploy/zapfloo-inventory.txt; fi
if [ -f deploy/zapfloo-delete-commands.txt ]; then echo; echo "=== deploy/zapfloo-delete-commands.txt"; cat deploy/zapfloo-delete-commands.txt; fi
echo; echo "=== imagens do app (latest = em uso; previous = base da reversao)"; docker image ls pearchat-app --format "table {{.Tag}}\t{{.CreatedSince}}\t{{.Size}}"
echo; echo "=== docker ps -a"; docker ps -a --format "table {{.Names}}\t{{.Status}}"
echo; echo "=== df -h /"; df -h /
'
