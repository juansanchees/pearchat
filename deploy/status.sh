#!/usr/bin/env bash
# Diagnostico: UMA conexao SSH, somente leitura (log do ultimo deploy, inventario/comandos do Zapfloo, docker ps, disco).
KEY="${PEARCHAT_KEY:-$HOME/.ssh/pearchat_vps}"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 "root@${PEARCHAT_HOST:-82.25.79.194}" '
cd /opt/pearchat || exit 1
echo "=== deploy/last-deploy.log (ultimas 100 linhas)"; tail -100 deploy/last-deploy.log
if [ -f deploy/zapfloo-inventory.txt ]; then echo; echo "=== deploy/zapfloo-inventory.txt"; cat deploy/zapfloo-inventory.txt; fi
if [ -f deploy/zapfloo-delete-commands.txt ]; then echo; echo "=== deploy/zapfloo-delete-commands.txt"; cat deploy/zapfloo-delete-commands.txt; fi
echo; echo "=== docker ps -a"; docker ps -a --format "table {{.Names}}\t{{.Status}}"
echo; echo "=== df -h /"; df -h /
'
