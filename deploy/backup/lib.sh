#!/usr/bin/env bash
# Funcoes puras do backup (sem efeitos colaterais na carga). Usado por backup.sh, restore.sh e pelo teste.
# Nao executar diretamente.

# Decodifica %XX (usado nos campos usuario/senha/banco da URL).
bk_urldecode() {
  local s="${1//\\/\\\\}"
  printf '%b' "${s//%/\\x}"
}

# Quebra uma URL postgres:// em PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE (variaveis globais).
# Ignora ?schema=...&connection_limit=... (parametros do Prisma que o pg_dump nao entende), mas respeita sslmode.
# Pooler de transacao do Supabase (porta 6543) nao serve para pg_dump: usa a porta 5432 (modo sessao) do mesmo host.
bk_parse_db_url() {
  local url="$1" rest query="" auth hostpart hostport db
  case "$url" in postgres://*|postgresql://*) ;; *) return 1 ;; esac
  rest="${url#*://}"
  if [[ "$rest" == *\?* ]]; then query="${rest#*\?}"; rest="${rest%%\?*}"; fi
  [[ "$rest" == *@* ]] || return 1
  auth="${rest%@*}"
  hostpart="${rest##*@}"
  hostport="${hostpart%%/*}"
  if [[ "$hostpart" == */* ]]; then db="${hostpart#*/}"; else db=postgres; fi
  PGUSER="$(bk_urldecode "${auth%%:*}")"
  if [[ "$auth" == *:* ]]; then PGPASSWORD="$(bk_urldecode "${auth#*:}")"; else PGPASSWORD=""; fi
  PGHOST="${hostport%%:*}"
  if [[ "$hostport" == *:* ]]; then PGPORT="${hostport##*:}"; else PGPORT=5432; fi
  PGDATABASE="$(bk_urldecode "${db:-postgres}")"
  PGSSLMODE=require
  case "&$query&" in *"&sslmode=disable&"*) PGSSLMODE=disable ;; *"&sslmode=prefer&"*) PGSSLMODE=prefer ;; esac
  PG_PORT_ADJUSTED=0
  if [[ "$PGHOST" == *pooler.supabase.com && "$PGPORT" == 6543 ]]; then PGPORT=5432; PG_PORT_ADJUSTED=1; fi
  [[ -n "$PGHOST" && -n "$PGUSER" && "$PGPORT" =~ ^[0-9]+$ ]] || return 1
  # Uma linha por variavel no --env-file: nada de quebra de linha nos valores.
  case "$PGUSER$PGPASSWORD$PGHOST$PGDATABASE" in *$'\n'*|*$'\r'*) return 1 ;; esac
  return 0
}

# Le nomes AAAA-MM-DD_HHMM (stdin, qualquer ordem) e imprime os que devem ser MANTIDOS:
#  - diarios: o backup mais recente de cada um dos ultimos N dias (BACKUP_KEEP_DAILY, padrao 7)
#  - semanais: o mais recente de cada domingo, os ultimos N (BACKUP_KEEP_WEEKLY, padrao 4)
#  - mensais: o mais recente de cada dia 1, os ultimos N (BACKUP_KEEP_MONTHLY, padrao 3)
bk_keep_list() {
  local kd="${BACKUP_KEEP_DAILY:-7}" kw="${BACKUP_KEEP_WEEKLY:-4}" km="${BACKUP_KEEP_MONTHLY:-3}"
  local nd=0 nw=0 nm=0 name day wd
  local -A seen=() keep=()
  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$ ]] || continue
    day="${name%%_*}"
    [[ -z "${seen[$day]:-}" ]] || continue # so o mais recente de cada dia entra (lista em ordem decrescente)
    seen[$day]=1
    if (( nd < kd )); then keep[$name]=1; nd=$((nd + 1)); fi
    wd="$(date -d "$day" +%u 2>/dev/null || echo 0)"
    if [[ "$wd" == 7 ]] && (( nw < kw )); then keep[$name]=1; nw=$((nw + 1)); fi
    if [[ "$day" == *-01 ]] && (( nm < km )); then keep[$name]=1; nm=$((nm + 1)); fi
  done < <(sort -r)
  for name in "${!keep[@]}"; do printf '%s\n' "$name"; done | sort
}

# Aplica a rotacao em $1 (pasta de backups). Apaga SOMENTE subpastas cujo nome e AAAA-MM-DD_HHMM, dentro de $1.
# Imprime as pastas removidas. Nunca roda com $1 vazio/raiz; nunca apaga se a lista de mantidos vier vazia.
bk_rotate() {
  local root="$1" name keep all
  [[ -n "$root" && "$root" == /* && "$root" != "/" && "$root" != "//" && "$root" != *..* && -d "$root" ]] || return 1
  all="$(ls -1 "$root" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' || true)"
  [[ -n "$all" ]] || return 0
  keep="$(printf '%s\n' "$all" | bk_keep_list)"
  [[ -n "$keep" ]] || return 0
  while IFS= read -r name; do
    [[ "$name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$ ]] || continue
    grep -qxF -- "$name" <<<"$keep" && continue
    [[ -d "$root/$name" && ! -L "$root/$name" ]] || continue
    rm -rf -- "${root:?}/${name:?}"
    printf '%s\n' "$name"
  done <<<"$all"
}

# Apaga com seguranca (shred -n1 quando existir) uma arvore temporaria. $1 = pasta, $2 = pasta-mae obrigatoria.
bk_shred_tree() {
  local dir="$1" parent="$2"
  [[ -n "$dir" && -n "$parent" && "$dir" == "$parent"/?* && "$dir" != *..* ]] || return 1
  [[ -d "$dir" && ! -L "$dir" ]] || return 0
  if command -v shred >/dev/null 2>&1; then
    find "$dir" -type f -exec shred -n 1 -u -- {} + 2>/dev/null || true
  fi
  rm -rf -- "$dir"
}

# Escapa texto para dentro de uma string JSON.
bk_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"; s="${s//$'\r'/ }"; s="${s//$'\t'/ }"
  printf '%s' "$s"
}

# Lista "nome|bytes|sha256" dos arquivos regulares de uma pasta.
bk_components() {
  local dir="$1" f
  for f in "$dir"/*; do
    [[ -f "$f" ]] || continue
    printf '%s|%s|%s\n' "$(basename "$f")" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
  done
}
