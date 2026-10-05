#!/usr/bin/env bash
# Roda NA VPS (chamado por remote.sh, dentro de /opt/pearchat). Cuida do arquivo de ambiente do SERVIDOR:
#   - o arquivo do servidor e a FONTE DA VERDADE: este script NUNCA troca nem apaga um valor existente;
#   - so ACRESCENTA chaves que faltam (com valor seguro), depois de uma copia de seguranca datada (permissao 600);
#   - fixa a versao das imagens que JA estao rodando (CADDY_IMAGE etc.) para o proximo `compose up` nao subir versao nova;
#   - garante permissao 600 e guarda so as 10 copias mais recentes.
# Nao imprime valores: so os NOMES das chaves acrescentadas.
# Uso manual (para ver o que faria, sem alterar): DRY_RUN=1 bash deploy/env-sync.sh
set -uo pipefail
umask 077
ENVF="${ENVF:-deploy/.env.production}"
PROJECT="${COMPOSE_PROJECT:-pearchat}"
KEEP_BACKUPS="${ENV_BACKUPS_KEEP:-10}"

[ -f "$ENVF" ] || { echo "env-sync: $ENVF nao existe"; exit 1; }
chmod 600 "$ENVF" 2>/dev/null || true

have() { grep -q "^$1=" "$ENVF"; }
ADD=(); NAMES=()
add_line() { ADD+=("$1='$2'"); NAMES+=("$1"); }
random_token() { openssl rand -base64 48 2>/dev/null | tr -d '\n=+/' | cut -c1-43; }

# --- chaves que o app/monitor esperam e que o servidor pode nao ter ---
have HEALTH_TOKEN || { t="$(random_token)"; [ -n "$t" ] && add_line HEALTH_TOKEN "$t"; }
have WA_MOCK || add_line WA_MOCK false
have NEXT_PUBLIC_WA_MOCK || add_line NEXT_PUBLIC_WA_MOCK false
have BILLING_ENABLED || add_line BILLING_ENABLED false

# --- versao das imagens ja em uso (so quando o container esta de pe e a imagem tem digest de registro) ---
pin_image() { # $1 = variavel, $2 = servico do compose
  have "$1" && return 0
  command -v docker >/dev/null 2>&1 || return 0
  local cid iid dig
  cid="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$2" 2>/dev/null | head -n1)"
  [ -n "$cid" ] || return 0
  iid="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null)"
  [ -n "$iid" ] || return 0
  dig="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$iid" 2>/dev/null | head -n1)"
  case "$dig" in *@sha256:*) add_line "$1" "$dig" ;; *) echo "env-sync: sem digest para $2 (imagem sem registro); $1 nao fixada" ;; esac
}
pin_image CADDY_IMAGE caddy
pin_image EVOLUTION_IMAGE evolution
pin_image EVOLUTION_DB_IMAGE evolution-db
pin_image EVOLUTION_REDIS_IMAGE evolution-redis

if [ "${#ADD[@]}" -eq 0 ]; then
  echo "env-sync: nada a acrescentar em $ENVF"
  exit 0
fi

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "env-sync (simulacao): acrescentaria: ${NAMES[*]}"
  exit 0
fi

BAK="$ENVF.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENVF" "$BAK" && chmod 600 "$BAK" || { echo "env-sync: nao consegui criar a copia $BAK; NADA foi alterado"; exit 1; }
# garante quebra de linha no fim antes de acrescentar
[ -z "$(tail -c1 "$ENVF" 2>/dev/null)" ] || printf '\n' >> "$ENVF"
printf '%s\n' "${ADD[@]}" >> "$ENVF"
chmod 600 "$ENVF"
echo "env-sync: acrescentadas ${#NAMES[@]} chave(s) novas: ${NAMES[*]} (copia de seguranca: $BAK)"

# rotacao das copias
# shellcheck disable=SC2012
ls -1t "$ENVF".bak-* 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | while IFS= read -r old; do rm -f -- "$old"; done
exit 0
