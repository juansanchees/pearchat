#!/usr/bin/env bash
# Restauracao de um backup do PearChat. Roda NA VPS, como root. Interativo e explicito.
#
#   bash deploy/backup/restore.sh --verify [PACOTE]         so descriptografa e valida (nao restaura nada)
#   bash deploy/backup/restore.sh [PACOTE]                  restaura o banco do app num schema NOVO pearchat_restore_<data>
#   bash deploy/backup/restore.sh --overwrite [PACOTE]      restaura NO LUGAR do schema pearchat (confirmacao dupla;
#                                                           o schema atual e RENOMEADO, nunca apagado)
#   ... --volumes                                           tambem restaura os volumes (midia, instancias Evolution, caddy)
#   ... --evolution                                         tambem restaura o banco da Evolution (confirmacao propria)
#   ... --extract-env DIR                                   grava o env.production do pacote em DIR/env.production (600)
# PACOTE = caminho do .tar.enc, nome da pasta (AAAA-MM-DD_HHMM) ou omitido (lista e pergunta).
# Variaveis: BACKUP_ROOT, BACKUP_KEY_FILE (ou RESTORE_KEY_FILE), BACKUP_PG_IMAGE, RESTORE_DATABASE_URL (padrao: DATABASE_URL do .env.production).
set -euo pipefail
umask 077
export LC_ALL=C
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck disable=SC1091
[ -f /etc/pearchat-backup.conf ] && . /etc/pearchat-backup.conf

APP_DIR="${APP_DIR:-/opt/pearchat}"
ENV_FILE="${ENV_FILE:-$APP_DIR/deploy/.env.production}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/pearchat-backups}"
KEY_FILE="${RESTORE_KEY_FILE:-${BACKUP_KEY_FILE:-/root/.pearchat-backup-key}}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"
APP_SCHEMA="${BACKUP_APP_SCHEMA:-pearchat}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-pearchat}"
EVO_DB_USER="${EVO_DB_USER:-evolution}"
EVO_DB_NAME="${EVO_DB_NAME:-evolution}"

VERIFY=0; OVERWRITE=0; VOLUMES=0; EVOLUTION=0; EXTRACT_ENV=""; TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY=1 ;;
    --overwrite) OVERWRITE=1 ;;
    --volumes) VOLUMES=1 ;;
    --evolution) EVOLUTION=1 ;;
    --extract-env) shift; EXTRACT_ENV="${1:-}"; [ -n "$EXTRACT_ENV" ] || { echo "--extract-env precisa de uma pasta"; exit 1; } ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "opcao desconhecida: $1"; exit 1 ;;
    *) TARGET="$1" ;;
  esac
  shift
done

die() { echo "ERRO: $*" >&2; exit 1; }
ask() { local a; read -r -p "$1" a < /dev/tty || die "sem terminal para confirmar"; printf '%s' "$a"; }

[ "$(id -u)" = 0 ] || die "rode como root"
for c in docker openssl tar sha256sum; do command -v "$c" >/dev/null 2>&1 || die "comando ausente: $c"; done
[ -s "$KEY_FILE" ] || die "chave nao encontrada em $KEY_FILE. Se o servidor foi perdido, grave a chave guardada fora dele nesse caminho (permissao 600) ou use RESTORE_KEY_FILE=/caminho/da/chave"

# ---- escolher o pacote ----
if [ -z "$TARGET" ]; then
  echo "Backups disponiveis em $BACKUP_ROOT:"
  found=0
  for d in $(ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' | sort -r); do
    f="$BACKUP_ROOT/$d/pearchat-$d.tar.enc"
    [ -f "$f" ] || continue
    found=1; printf '  %s  %s MB\n' "$d" "$(( $(stat -c %s "$f") / 1024 / 1024 ))"
  done
  [ "$found" = 1 ] || die "nenhum backup encontrado. Informe o caminho do .tar.enc"
  TARGET="$(ask 'Qual restaurar (AAAA-MM-DD_HHMM)? ')"
fi
if [ -f "$TARGET" ]; then PKG="$TARGET"; else PKG="$BACKUP_ROOT/$TARGET/pearchat-$TARGET.tar.enc"; fi
[ -f "$PKG" ] || die "pacote nao encontrado: $PKG"
STAMP="$(basename "$PKG" .tar.enc)"; STAMP="${STAMP#pearchat-}"

# ---- descriptografar numa pasta temporaria 700 ----
mkdir -p "$BACKUP_ROOT"; chmod 700 "$BACKUP_ROOT"
WORK="$(mktemp -d "$BACKUP_ROOT/.tmp-restore-XXXXXXXX")"
cleanup() { bk_shred_tree "$WORK" "$BACKUP_ROOT" || true; }
trap cleanup EXIT
echo "Descriptografando $(basename "$PKG") ..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$PKG" | tar -xf - -C "$WORK" \
  || die "falha ao abrir o pacote (chave errada ou arquivo corrompido)"
[ -s "$WORK/app.dump" ] || die "o pacote nao contem app.dump"

echo; echo "Conteudo do pacote:"
for f in "$WORK"/*; do printf '  %-48s %s bytes\n' "$(basename "$f")" "$(stat -c %s "$f")"; done
if [ -f "$WORK/manifest.json" ]; then
  echo; echo "Manifesto (resumo):"
  grep -E '"(stamp|geradoEmUtc|versaoApp|imagemPgDump|tabelasNoSchema|avisos)"' "$WORK/manifest.json" | sed 's/^ */  /'
fi

# ---- validar: hashes do manifesto interno + pg_restore --list ----
echo; echo "Validando integridade ..."
bad=0
if [ -f "$WORK/manifest.json" ]; then
  while IFS= read -r line; do
    n="$(printf '%s' "$line" | sed -n 's/.*"nome": "\([^"]*\)".*/\1/p')"
    h="$(printf '%s' "$line" | sed -n 's/.*"sha256": "\([0-9a-f]*\)".*/\1/p')"
    [ -n "$n" ] && [ -n "$h" ] && [ -f "$WORK/$n" ] || continue
    [ "$(sha256sum "$WORK/$n" | cut -d' ' -f1)" = "$h" ] || { echo "  HASH DIFERENTE: $n"; bad=1; }
  done < <(grep '"nome"' "$WORK/manifest.json")
fi
docker run --rm -v "$WORK:/in:ro" --entrypoint pg_restore "$PG_IMAGE" --list /in/app.dump >/dev/null || bad=1
[ ! -f "$WORK/evolution.dump" ] || docker run --rm -v "$WORK:/in:ro" --entrypoint pg_restore "$PG_IMAGE" --list /in/evolution.dump >/dev/null || bad=1
for t in "$WORK"/vol-*.tar.gz; do [ -f "$t" ] || continue; tar -tzf "$t" >/dev/null || { echo "  tar corrompido: $(basename "$t")"; bad=1; }; done
[ "$bad" = 0 ] || die "validacao falhou: este pacote NAO e confiavel"
echo "  OK: hashes, dumps e tars integros."

if [ -n "$EXTRACT_ENV" ]; then
  [ -d "$EXTRACT_ENV" ] || die "pasta inexistente: $EXTRACT_ENV"
  [ -f "$WORK/env.production" ] || die "o pacote nao tem env.production"
  cp -- "$WORK/env.production" "$EXTRACT_ENV/env.production"; chmod 600 "$EXTRACT_ENV/env.production"
  echo "env.production gravado em $EXTRACT_ENV/env.production (contem segredos: proteja)"
fi
if [ "$VERIFY" = 1 ]; then echo; echo "VERIFY_OK ($STAMP)"; exit 0; fi

# ---- conexao de destino (Supabase) ----
raw="${RESTORE_DATABASE_URL:-}"
if [ -z "$raw" ]; then
  raw="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
  raw="${raw%\'}"; raw="${raw#\'}"; raw="${raw%\"}"; raw="${raw#\"}"
fi
bk_parse_db_url "$raw" || die "DATABASE_URL de destino ausente/invalida (use RESTORE_DATABASE_URL)"
unset raw
printf 'PGHOST=%s\nPGPORT=%s\nPGUSER=%s\nPGPASSWORD=%s\nPGDATABASE=%s\nPGSSLMODE=%s\nPGCONNECT_TIMEOUT=20\n' \
  "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE" > "$WORK/.pg.env"
unset PGPASSWORD
DEST_HOST="$PGHOST"; DEST_DB="$PGDATABASE"; unset PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE
psql_c() { docker run --rm -i --env-file "$WORK/.pg.env" -v "$WORK:/in" --entrypoint psql "$PG_IMAGE" -v ON_ERROR_STOP=1 "$@"; }

TS="$(date +%Y%m%d_%H%M%S)"
if [ "$OVERWRITE" = 1 ]; then
  NEWSCHEMA="$APP_SCHEMA"
else
  NEWSCHEMA="pearchat_restore_${STAMP%%_*}"; NEWSCHEMA="${NEWSCHEMA//-/}"
fi
[[ "$NEWSCHEMA" =~ ^[a-z_][a-z0-9_]*$ ]] || die "nome de schema invalido: $NEWSCHEMA"

exists="$(psql_c -tA -c "select count(*) from information_schema.schemata where schema_name='$NEWSCHEMA'" | tr -d '[:space:]')"
echo; echo "Destino: banco $DEST_DB em $DEST_HOST"

if [ "$OVERWRITE" = 1 ]; then
  echo "ATENCAO: vai SUBSTITUIR o schema '$APP_SCHEMA' (producao) pelo conteudo do backup $STAMP."
  echo "O schema atual NAO sera apagado: sera renomeado para ${APP_SCHEMA}_antes_$TS."
  echo "Recomendado parar o app durante a restauracao (docker stop ${COMPOSE_PROJECT}-app-1)."
  [ "$(ask "1/2 Digite o nome do schema ($APP_SCHEMA) para continuar: ")" = "$APP_SCHEMA" ] || die "cancelado"
  [ "$(ask '2/2 Digite SOBRESCREVER para confirmar: ')" = "SOBRESCREVER" ] || die "cancelado"
  app_c="${COMPOSE_PROJECT}-app-1"
  if docker ps -q --filter "name=^${app_c}\$" | grep -q .; then
    if [ "$(ask "Parar o container $app_c agora? (s/N) ")" = s ]; then docker stop "$app_c" >/dev/null; echo "app parado (suba depois: docker start $app_c)"; fi
  fi
  if [ "$exists" != 0 ]; then
    psql_c -c "ALTER SCHEMA \"$APP_SCHEMA\" RENAME TO \"${APP_SCHEMA}_antes_$TS\"" >/dev/null
    echo "schema antigo guardado como ${APP_SCHEMA}_antes_$TS"
  fi
else
  if [ "$exists" != 0 ]; then
    NEWSCHEMA="${NEWSCHEMA}_${TS#*_}"
    echo "(o schema ja existia; usando $NEWSCHEMA)"
  fi
  echo "O banco do app sera restaurado num schema NOVO: $NEWSCHEMA (o '$APP_SCHEMA' de producao nao e tocado)."
  [ "$(ask "Digite o nome do schema novo ($NEWSCHEMA) para continuar: ")" = "$NEWSCHEMA" ] || die "cancelado"
fi

# ---- restaurar o app ----
# O dump e do schema "pearchat". Para outro nome, a parte de estrutura (pre/pos-dados) e reescrita; as linhas de
# dados (COPY ... FROM stdin) so tem o cabecalho trocado, nunca o conteudo.
docker run --rm -v "$WORK:/in" --entrypoint sh "$PG_IMAGE" -c '
  set -e
  pg_restore --section=pre-data  -f /in/pre.sql  /in/app.dump
  pg_restore --section=data      -f /in/data.sql /in/app.dump
  pg_restore --section=post-data -f /in/post.sql /in/app.dump'
if [ "$NEWSCHEMA" != "$APP_SCHEMA" ]; then
  re_ddl="s/(^|[^A-Za-z0-9_\"'])${APP_SCHEMA}([.\"])/\\1${NEWSCHEMA}\\2/g; s/^(CREATE SCHEMA |ALTER SCHEMA )${APP_SCHEMA}( |;)/\\1${NEWSCHEMA}\\2/"
  sed -E -i "$re_ddl" "$WORK/pre.sql" "$WORK/post.sql"
  sed -E -i "s/^(COPY )${APP_SCHEMA}\\./\\1${NEWSCHEMA}./; s/^(SELECT pg_catalog.setval\\(')${APP_SCHEMA}\\./\\1${NEWSCHEMA}./" "$WORK/data.sql"
fi
cat "$WORK/pre.sql" "$WORK/data.sql" "$WORK/post.sql" > "$WORK/all.sql"
echo "Aplicando no banco (uma transacao) ..."
psql_c --single-transaction -q -f /in/all.sql >/dev/null
cnt="$(psql_c -tA -c "select count(*) from information_schema.tables where table_schema='$NEWSCHEMA'" | tr -d '[:space:]')"
echo "Restauracao do app concluida: $cnt tabelas em '$NEWSCHEMA'."
if [ "$NEWSCHEMA" != "$APP_SCHEMA" ]; then
  echo "Para inspecionar: select count(*) from $NEWSCHEMA.\"User\";"
  echo "Quando terminar de conferir, apague com cuidado: DROP SCHEMA $NEWSCHEMA CASCADE;  (manual, no SQL Editor do Supabase)"
fi

# ---- Evolution (opcional) ----
if [ "$EVOLUTION" = 1 ]; then
  [ -f "$WORK/evolution.dump" ] || die "o pacote nao tem evolution.dump"
  echo; echo "ATENCAO: vai SUBSTITUIR o banco da Evolution (sessoes/mensagens do WhatsApp) pelo do backup."
  [ "$(ask 'Digite evolution para continuar: ')" = "evolution" ] || die "cancelado"
  evo="$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter "label=com.docker.compose.service=evolution-db" | head -n1)"
  [ -n "$evo" ] || die "container evolution-db nao esta rodando"
  evoapp="$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter "label=com.docker.compose.service=evolution" | head -n1 || true)"
  [ -z "$evoapp" ] || docker stop "$evoapp" >/dev/null
  docker exec -i "$evo" pg_restore -U "$EVO_DB_USER" -d "$EVO_DB_NAME" --clean --if-exists --no-owner --no-privileges < "$WORK/evolution.dump" \
    || echo "(pg_restore terminou com avisos; confira)"
  [ -z "$evoapp" ] || docker start "$evoapp" >/dev/null
  echo "Banco da Evolution restaurado."
fi

# ---- Volumes (opcional) ----
if [ "$VOLUMES" = 1 ]; then
  echo; echo "ATENCAO: vai extrair os volumes do backup por cima dos volumes atuais (arquivos com o mesmo nome sao sobrescritos)."
  [ "$(ask 'Digite volumes para continuar: ')" = "volumes" ] || die "cancelado"
  for t in "$WORK"/vol-*.tar.gz; do
    [ -f "$t" ] || continue
    v="$(basename "$t" .tar.gz)"; v="${v#vol-}"
    [[ "$v" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "nome de volume suspeito, ignorado: $v"; continue; }
    if [ -n "$(docker ps -q --filter "volume=$v")" ]; then
      echo "volume $v esta em uso por container em execucao: pare-o antes (docker stop ...) e rode de novo. Ignorado."
      continue
    fi
    docker volume create "$v" >/dev/null
    docker run --rm -v "$v:/dst" -v "$WORK:/in:ro" --entrypoint sh "$PG_IMAGE" -c "cd /dst && tar -xzf /in/$(basename "$t")"
    echo "volume $v restaurado."
  done
fi
echo; echo "RESTORE_OK ($STAMP)"
