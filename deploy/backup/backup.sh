#!/usr/bin/env bash
# Backup do PearChat. Roda NA VPS, como root, pelo cron (/etc/cron.d/pearchat-backup) ou a mao:
#   bash /opt/pearchat/deploy/backup/backup.sh
# Gera /opt/pearchat-backups/AAAA-MM-DD_HHMM/pearchat-AAAA-MM-DD_HHMM.tar.enc (AES-256, chave em /root/.pearchat-backup-key)
# com: dump do schema "pearchat" do Supabase, dump do banco da Evolution, volumes (midia, instancias da Evolution,
# certificados do Caddy) e o .env.production. Depois verifica, grava manifest.json, rotaciona e (opcional) copia para fora.
#
# Variaveis (ambiente ou /etc/pearchat-backup.conf):
#   BACKUP_PG_IMAGE=postgres:17-alpine   imagem do pg_dump (versao do cliente >= a do servidor Supabase)
#   BACKUP_ROOT=/opt/pearchat-backups    BACKUP_KEY_FILE=/root/.pearchat-backup-key   BACKUP_MIN_FREE_GB=3
#   BACKUP_KEEP_DAILY=7 BACKUP_KEEP_WEEKLY=4 BACKUP_KEEP_MONTHLY=3
#   BACKUP_REMOTE=rclone:<remote>:<caminho>   BACKUP_REMOTE_KEEP_DAYS=<n>   (copia externa opcional; exige rclone)
#   BACKUP_VOLUMES="vol1 vol2"           (sobrescreve a descoberta automatica dos volumes)
# Codigos de saida: 0 ok | 1 falha (nada guardado) | 2 parcial (pacote gerado, mas faltou algum componente opcional)
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
COMPOSE_PROJECT="${COMPOSE_PROJECT:-pearchat}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/pearchat-backups}"
KEY_FILE="${BACKUP_KEY_FILE:-/root/.pearchat-backup-key}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"
APP_SCHEMA="${BACKUP_APP_SCHEMA:-pearchat}"
EVO_DB_USER="${EVO_DB_USER:-evolution}"
EVO_DB_NAME="${EVO_DB_NAME:-evolution}"
MIN_FREE_KB=$(( ${BACKUP_MIN_FREE_GB:-3} * 1024 * 1024 ))
LOG="${BACKUP_LOG:-/var/log/pearchat-backup.log}"
STATUS_FILE="$BACKUP_ROOT/last-status.json"
STAMP="$(TZ=America/Sao_Paulo date +%Y-%m-%d_%H%M)"

STEP="inicio"; STAGE=""; FINAL_DIR=""; PKG=""; WARNINGS=""; REMOTE_STATE="desativado"; PKG_BYTES=0
T0=$SECONDS

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG" 2>/dev/null || printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
warn() { WARNINGS="${WARNINGS:+$WARNINGS; }$*"; log "AVISO: $*"; }
fail() { STEP="$*"; log "ERRO: $*"; exit 1; }

write_status() { # $1 = true|false, $2 = erro
  [ -d "$BACKUP_ROOT" ] || return 0
  local now prev_ok tmp
  now="$(date +%s)"
  prev_ok="$(sed -n 's/^ *"ultimoOkEpoch": *\([0-9]*\).*/\1/p' "$STATUS_FILE" 2>/dev/null | head -n1 || true)"
  [ "$1" = true ] && prev_ok="$now"
  tmp="$BACKUP_ROOT/.last-status.tmp"
  cat > "$tmp" <<JSON
{
  "ok": $1,
  "quando": "$(date -u -d "@$now" +%FT%TZ)",
  "quandoEpoch": $now,
  "ultimoOkEpoch": ${prev_ok:-0},
  "tamanhoBytes": $PKG_BYTES,
  "pacote": "$(bk_json_str "$(basename "${PKG:-}")")",
  "duracaoSeg": $((SECONDS - T0)),
  "remoto": "$REMOTE_STATE",
  "chaveImpressao": "$(bk_key_fingerprint "$KEY_FILE")",
  "erro": "$(bk_json_str "$2")"
}
JSON
  mv -f "$tmp" "$STATUS_FILE"
  # Copia MINIMA do status para o app ler (pasta montada SOMENTE LEITURA em /data/backup-status; alimenta o alerta
  # "backup_atrasado" de /api/health/check). So resultado e horario: sem chave, sem caminho de pacote, sem mensagens de erro.
  local pub="$BACKUP_ROOT/status"
  if mkdir -p "$pub" 2>/dev/null; then
    chmod 755 "$pub" 2>/dev/null || true
    if printf '{"ok": %s, "ultimoOkEpoch": %s, "quandoEpoch": %s, "remoto": "%s"}\n' "$1" "${prev_ok:-0}" "$now" "$REMOTE_STATE" > "$pub/.backup.tmp"; then
      chmod 644 "$pub/.backup.tmp" && mv -f "$pub/.backup.tmp" "$pub/backup.json" || true
    fi
  fi
}

cleanup_stage() {
  [ -n "$STAGE" ] && bk_shred_tree "$STAGE" "$BACKUP_ROOT" || true
}

finish() {
  local rc=$?
  trap - EXIT
  cleanup_stage
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
    # Falha: nao deixa pacote incompleto (so se a pasta for mesmo a deste backup, dentro de BACKUP_ROOT).
    if [ -n "$FINAL_DIR" ] && [ "$FINAL_DIR" = "$BACKUP_ROOT/$STAMP" ] && [ -d "$FINAL_DIR" ]; then rm -rf -- "${BACKUP_ROOT:?}/${STAMP:?}"; fi
    log "FALHOU na etapa: $STEP (codigo $rc)"
    PKG=""; PKG_BYTES=0
    write_status false "falha na etapa: $STEP"
  fi
  exit "$rc"
}
trap finish EXIT
trap 'STEP="interrompido por sinal"; exit 130' INT TERM HUP

# ---------- pre-requisitos ----------
STEP="pre-requisitos"
[ "$(id -u)" = 0 ] || fail "rode como root"
for c in docker openssl tar sha256sum df awk; do command -v "$c" >/dev/null 2>&1 || fail "comando ausente: $c"; done
docker info >/dev/null 2>&1 || fail "docker indisponivel"
[ -s "$KEY_FILE" ] || fail "chave de criptografia ausente: $KEY_FILE (rode deploy/backup/install.sh)"
[ "$(stat -c %a "$KEY_FILE")" = 600 ] || { chmod 600 "$KEY_FILE"; log "permissao de $KEY_FILE corrigida para 600"; }
[ -r "$ENV_FILE" ] || fail "nao encontrei $ENV_FILE"
mkdir -p "$BACKUP_ROOT"; chmod 700 "$BACKUP_ROOT"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_ROOT/.lock"
  flock -n 9 || fail "outro backup ja esta em andamento"
fi
free_kb="$(df -Pk "$BACKUP_ROOT" | awk 'NR==2{print $4}')"
[ "${free_kb:-0}" -ge "$MIN_FREE_KB" ] || fail "espaco insuficiente em $BACKUP_ROOT: $((free_kb / 1024)) MB livres, minimo $((MIN_FREE_KB / 1024)) MB"
[ ! -e "$BACKUP_ROOT/$STAMP" ] || fail "ja existe backup de $STAMP (aguarde 1 minuto)"

# Sobras de execucoes interrompidas (mais de 1 dia).
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '.tmp-*' -mmin +1440 2>/dev/null | while IFS= read -r old; do bk_shred_tree "$old" "$BACKUP_ROOT" || true; done

log "inicio do backup $STAMP (imagem pg_dump: $PG_IMAGE, livre: $((free_kb / 1024)) MB)"
STAGE="$(mktemp -d "$BACKUP_ROOT/.tmp-XXXXXXXX")"
mkdir -m 700 "$STAGE/data"

# ---------- 1) dump do schema do app (Supabase) ----------
STEP="dump do schema $APP_SCHEMA (Supabase)"
raw="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
raw="${raw%\'}"; raw="${raw#\'}"; raw="${raw%\"}"; raw="${raw#\"}"
bk_parse_db_url "$raw" || fail "DATABASE_URL ausente ou invalida em $ENV_FILE"
unset raw
[ "${PG_PORT_ADJUSTED:-0}" = 1 ] && log "pooler de transacao (6543) trocado por modo sessao (5432) para o pg_dump"
# Credenciais por --env-file em arquivo 600 (nunca na linha de comando nem no log); apagado logo depois.
printf 'PGHOST=%s\nPGPORT=%s\nPGUSER=%s\nPGPASSWORD=%s\nPGDATABASE=%s\nPGSSLMODE=%s\nPGCONNECT_TIMEOUT=20\n' \
  "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE" > "$STAGE/pg.env"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE
if ! timeout 7200 docker run --rm --env-file "$STAGE/pg.env" -v "$STAGE/data:/out" --entrypoint pg_dump "$PG_IMAGE" \
     --schema="$APP_SCHEMA" --no-owner --no-privileges --format=custom --file=/out/app.dump 2>>"$LOG"; then
  bk_shred_tree "$STAGE" "$BACKUP_ROOT" >/dev/null 2>&1 || true
  fail "pg_dump do schema $APP_SCHEMA falhou (veja $LOG: versao do cliente x servidor, pooler, rede)"
fi
rm -f -- "$STAGE/pg.env"
[ -s "$STAGE/data/app.dump" ] || fail "dump do app veio vazio"
log "dump do app ok ($(stat -c %s "$STAGE/data/app.dump") bytes)"

# ---------- 2) dump do banco da Evolution ----------
STEP="dump do banco da Evolution"
evo="$(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter "label=com.docker.compose.service=evolution-db" | head -n1 || true)"
[ -n "$evo" ] || evo="$(docker ps -q --filter "name=${COMPOSE_PROJECT}-evolution-db-1" | head -n1 || true)"
if [ -z "$evo" ]; then
  warn "container evolution-db nao encontrado/rodando: dump da Evolution omitido"
elif docker exec "$evo" pg_dump -U "$EVO_DB_USER" -d "$EVO_DB_NAME" --format=custom --no-owner --no-privileges > "$STAGE/data/evolution.dump" 2>>"$LOG" \
     && [ -s "$STAGE/data/evolution.dump" ]; then
  log "dump da Evolution ok ($(stat -c %s "$STAGE/data/evolution.dump") bytes)"
else
  rm -f -- "$STAGE/data/evolution.dump"
  warn "dump da Evolution falhou"
fi

# ---------- 3) volumes (somente leitura) ----------
STEP="volumes"
if [ -n "${BACKUP_VOLUMES:-}" ]; then
  vols="$BACKUP_VOLUMES"
else
  vols="$( { docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" 2>/dev/null
             for v in "${COMPOSE_PROJECT}_media" "${COMPOSE_PROJECT}_evolution_instances" "${COMPOSE_PROJECT}_caddy_data"; do
               docker volume inspect "$v" >/dev/null 2>&1 && printf '%s\n' "$v"
             done; } | sort -u | grep -E "^${COMPOSE_PROJECT}_(media|evolution_instances|caddy_data)\$" || true)"
fi
for want in evolution_instances caddy_data; do
  printf '%s\n' "$vols" | grep -q "_${want}\$" || warn "volume ${COMPOSE_PROJECT}_${want} nao encontrado"
done
printf '%s\n' "$vols" | grep -q "_media\$" || log "volume de midia ainda nao existe (ok, sera incluido quando houver)"
for v in $vols; do
  if timeout 7200 docker run --rm -v "$v:/src:ro" -v "$STAGE/data:/out" --entrypoint tar "$PG_IMAGE" \
       -czf "/out/vol-$v.tar.gz" -C /src . 2>>"$LOG"; then
    log "volume $v ok ($(stat -c %s "$STAGE/data/vol-$v.tar.gz") bytes)"
  else
    rm -f -- "$STAGE/data/vol-$v.tar.gz"
    warn "tar do volume $v falhou"
  fi
done

# ---------- 4) .env.production e versao ----------
STEP="copia do .env.production"
cp -- "$ENV_FILE" "$STAGE/data/env.production"
[ -f "$APP_DIR/.deploy-commit" ] && cp -- "$APP_DIR/.deploy-commit" "$STAGE/data/deploy-commit.txt"
# Configuracao do backup e do monitor (canais de alerta, destino externo): ajuda a reconstruir a VPS. NAO inclui a
# credencial do rclone (~/.config/rclone/rclone.conf): essa o dono guarda a parte (docs/operacao/).
[ -f /etc/pearchat-backup.conf ] && cp -- /etc/pearchat-backup.conf "$STAGE/data/etc-pearchat-backup.conf"
[ -f /etc/pearchat-monitor.conf ] && cp -- /etc/pearchat-monitor.conf "$STAGE/data/etc-pearchat-monitor.conf"
# Lista das imagens em uso (versao exata para reconstruir igual): so nomes, sem segredos.
docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --format '{{.Names}} {{.Image}}' > "$STAGE/data/imagens-em-uso.txt" 2>/dev/null || true
APP_VERSION="$(tr -d '[:space:]' < "$APP_DIR/.deploy-commit" 2>/dev/null || true)"; APP_VERSION="${APP_VERSION:-desconhecida}"

# ---------- 5) verificacao dos componentes ----------
STEP="verificacao do dump/tars"
TABELAS=0
for d in app evolution; do
  [ -s "$STAGE/data/$d.dump" ] || continue
  lst="$STAGE/pr-$d.txt"
  docker run --rm -v "$STAGE/data:/in:ro" --entrypoint pg_restore "$PG_IMAGE" --list "/in/$d.dump" > "$lst" 2>>"$LOG" \
    || fail "pg_restore --list falhou em $d.dump (dump corrompido)"
  n="$(grep -c ' TABLE ' "$lst" || true)"
  [ "${n:-0}" -gt 0 ] || fail "$d.dump nao lista nenhuma tabela"
  [ "$d" = app ] && TABELAS="$n"
  rm -f -- "$lst"
done
for t in "$STAGE"/data/vol-*.tar.gz; do
  [ -f "$t" ] || continue
  tar -tzf "$t" >/dev/null 2>>"$LOG" || fail "tar corrompido: $(basename "$t")"
done
log "componentes verificados (tabelas no schema $APP_SCHEMA: $TABELAS)"

write_manifest() { # $1 = arquivo de saida, $2 = pacote(opcional: caminho do .enc)
  local out="$1" pk="${2:-}" first=1 line name bytes sha pkg_json=""
  {
    printf '{\n  "stamp": "%s",\n  "geradoEmUtc": "%s",\n  "duracaoSeg": %s,\n' "$STAMP" "$(date -u +%FT%TZ)" "$((SECONDS - T0))"
    printf '  "versaoApp": "%s",\n  "imagemPgDump": "%s",\n  "schema": "%s",\n  "tabelasNoSchema": %s,\n' \
      "$(bk_json_str "$APP_VERSION")" "$(bk_json_str "$PG_IMAGE")" "$(bk_json_str "$APP_SCHEMA")" "$TABELAS"
    printf '  "avisos": "%s",\n' "$(bk_json_str "$WARNINGS")"
    if [ -n "$pk" ]; then
      printf '  "pacote": {"arquivo": "%s", "bytes": %s, "sha256": "%s"},\n' "$(basename "$pk")" "$(stat -c %s "$pk")" "$(sha256sum "$pk" | cut -d' ' -f1)"
    fi
    printf '  "componentes": [\n'
    while IFS='|' read -r name bytes sha; do
      [ -n "$name" ] || continue
      [ "$first" = 1 ] || printf ',\n'
      first=0
      printf '    {"nome": "%s", "bytes": %s, "sha256": "%s"}' "$(bk_json_str "$name")" "$bytes" "$sha"
    done < <(bk_components "$STAGE/data")
    printf '\n  ]\n}\n'
  } > "$out"
}

# ---------- 6) empacotar + criptografar ----------
STEP="manifesto interno"
write_manifest "$STAGE/data/manifest.json"
STEP="empacotamento e criptografia"
FINAL_DIR="$BACKUP_ROOT/$STAMP"
mkdir -m 700 "$FINAL_DIR"
PKG="$FINAL_DIR/pearchat-$STAMP.tar.enc"
tar -cf - -C "$STAGE/data" . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_FILE" -out "$PKG"
PKG_BYTES="$(stat -c %s "$PKG")"
[ "$PKG_BYTES" -gt 1024 ] || fail "pacote criptografado pequeno demais"

STEP="verificacao do pacote criptografado"
# Descriptografa em fluxo e lista o tar: prova que a chave abre o pacote e que o conteudo esta integro.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_FILE" -in "$PKG" | tar -tf - >/dev/null \
  || fail "o pacote criptografado nao abre com a chave atual"
STEP="manifesto externo"
write_manifest "$FINAL_DIR/manifest.json" "$PKG"
cleanup_stage
STAGE=""
log "pacote $(basename "$PKG") ok ($((PKG_BYTES / 1024 / 1024)) MB)"

# ---------- 7) rotacao ----------
STEP="rotacao"
removed="$(bk_rotate "$BACKUP_ROOT" || true)"
[ -z "$removed" ] || log "rotacao removeu: $(printf '%s' "$removed" | tr '\n' ' ')"

# ---------- 8) copia externa (opcional) ----------
STEP="copia externa"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  REMOTE_STATE="erro"
  case "$BACKUP_REMOTE" in
    rclone:?*)
      dest="${BACKUP_REMOTE#rclone:}"; dest="${dest%/}"
      if ! command -v rclone >/dev/null 2>&1; then
        warn "BACKUP_REMOTE definido, mas rclone nao esta instalado: copia externa NAO feita"
      elif ! rclone copy "$FINAL_DIR" "$dest/$STAMP" --quiet 2>>"$LOG"; then
        warn "rclone copy falhou: copia externa NAO feita"
      elif ! rclone check "$FINAL_DIR" "$dest/$STAMP" --one-way --quiet 2>>"$LOG"; then
        # Confere no DESTINO (tamanho e hash, quando o provedor tem): copia que nao confere nao conta como backup.
        warn "copia externa enviada, mas a conferencia (rclone check) FALHOU: nao confie nesta copia"
      else
        REMOTE_STATE="ok"; log "copia externa ok e conferida em $dest/$STAMP"
        if [[ "${BACKUP_REMOTE_KEEP_DAYS:-}" =~ ^[1-9][0-9]*$ ]]; then
          rclone delete "$dest" --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" --include '*.tar.enc' --include 'manifest.json' --quiet 2>>"$LOG" || warn "limpeza remota falhou"
          rclone rmdirs "$dest" --leave-root --quiet 2>>"$LOG" || true
        fi
      fi ;;
    *) warn "BACKUP_REMOTE deve ter o formato rclone:<remote>:<caminho>" ;;
  esac
else
  log "sem copia externa configurada (BACKUP_REMOTE): este backup existe SOMENTE neste servidor"
fi

# ---------- fim ----------
STEP="fim"
if [ -n "$WARNINGS" ]; then
  log "backup PARCIAL concluido em $((SECONDS - T0))s: $WARNINGS"
  write_status false "parcial: $WARNINGS"
  exit 2
fi
write_status true ""
log "backup OK em $((SECONDS - T0))s (remoto: $REMOTE_STATE)"
exit 0
