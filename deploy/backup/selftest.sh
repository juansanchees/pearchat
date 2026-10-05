#!/usr/bin/env bash
# Autoteste local (sem Docker, sem VPS): rotacao, URL do banco, criptografia ida e volta, protecoes de caminho.
#   bash deploy/backup/selftest.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "  ok: $1"; }
bad() { echo "  FALHOU: $1"; fails=$((fails + 1)); }
eq() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (esperado '$2', veio '$1')"; }

echo "== rotacao (7 diarios, 4 semanais, 3 mensais)"
R="$T/backups"; mkdir -p "$R"
# 1 backup por dia, de 2026-04-01 a 2026-10-04 (hoje = 04/10/2026, domingo), mais um segundo backup no dia 04
d="2026-04-01"
while [ "$d" != "2026-10-05" ]; do mkdir -p "$R/${d}_0630"; d="$(date -d "$d + 1 day" +%F)"; done
mkdir -p "$R/2026-10-04_0900"      # segundo do mesmo dia: o mais novo vence, o 0630 sai
mkdir -p "$R/lixo" "$R/.tmp-abc" "$R/2026-13-99_xx"  # nao seguem o padrao: nunca apagados
echo x > "$R/last-status.json"
removed="$(bk_rotate "$R")"
left="$(ls -1 "$R" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$')"
# esperado: diarios 10-04(0900),10-03,10-02,10-01,09-30,09-29,09-28 ; domingos 10-04(0900),09-27,09-20,09-13 ; dias 1: 10-01,09-01,08-01
exp="$(printf '%s\n' 2026-10-04_0900 2026-10-03_0630 2026-10-02_0630 2026-10-01_0630 2026-09-30_0630 2026-09-29_0630 2026-09-28_0630 2026-09-27_0630 2026-09-20_0630 2026-09-13_0630 2026-09-01_0630 2026-08-01_0630 | sort)"
eq "$left" "$exp" "sobram exatamente os esperados"
[ -d "$R/lixo" ] && [ -d "$R/.tmp-abc" ] && [ -f "$R/last-status.json" ] && ok "itens fora do padrao intactos" || bad "itens fora do padrao foram apagados"
printf '%s\n' "$removed" | grep -q '2026-10-04_0630' && ok "o 0630 do dia 04 foi removido (o 0900 e o mais novo)" || bad "0630 do dia 04 deveria sair"

echo "== rotacao: protecoes"
bk_rotate "" >/dev/null 2>&1 && bad "raiz vazia aceita" || ok "raiz vazia recusada"
bk_rotate "/" >/dev/null 2>&1 && bad "/ aceita" || ok "/ recusado"
bk_rotate "relativo" >/dev/null 2>&1 && bad "caminho relativo aceito" || ok "caminho relativo recusado"
bk_rotate "$T/../x" >/dev/null 2>&1 && bad "'..' aceito" || ok "'..' recusado"
E="$T/vazio"; mkdir -p "$E"; bk_rotate "$E" >/dev/null && ok "pasta sem backups: nada a fazer" || bad "pasta vazia deu erro"
mkdir -p "$T/ln/real" "$T/ln/dest"; touch "$T/ln/real/keep"; ln -s "$T/ln/real" "$T/ln/2020-01-01_0100" 2>/dev/null
bk_rotate "$T/ln" >/dev/null; [ -f "$T/ln/real/keep" ] && ok "symlink nao seguido" || bad "symlink seguido"
export BACKUP_KEEP_DAILY=2 BACKUP_KEEP_WEEKLY=0 BACKUP_KEEP_MONTHLY=0
eq "$(printf '%s\n' 2026-10-01_0300 2026-10-02_0300 2026-10-03_0300 | bk_keep_list | tr '\n' ' ')" "2026-10-02_0300 2026-10-03_0300 " "limites configuraveis"
unset BACKUP_KEEP_DAILY BACKUP_KEEP_WEEKLY BACKUP_KEEP_MONTHLY

echo "== URL do banco"
bk_parse_db_url 'postgresql://postgres.abcd:p%40ss%2Fw%3Ard@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?schema=pearchat&connection_limit=5&pgbouncer=true' \
  && ok "parse ok" || bad "parse falhou"
eq "$PGHOST" "aws-0-sa-east-1.pooler.supabase.com" "host"
eq "$PGPORT" "5432" "pooler 6543 -> 5432 (modo sessao)"
eq "$PGUSER" "postgres.abcd" "usuario"
eq "$PGPASSWORD" 'p@ss/w:rd' "senha decodificada"
eq "$PGDATABASE" "postgres" "banco"
eq "$PGSSLMODE" "require" "ssl"
bk_parse_db_url 'postgresql://u:pw@db.exemplo.com/meudb' && eq "$PGPORT/$PGDATABASE" "5432/meudb" "porta padrao e banco" || bad "parse 2"
bk_parse_db_url 'mysql://x' && bad "mysql aceito" || ok "esquema invalido recusado"
bk_parse_db_url '' && bad "vazio aceito" || ok "vazio recusado"

cd "$T" || exit 1
echo "== criptografia ida e volta (mesmos parametros do backup.sh)"
printf 'chave-de-teste-%s' "$RANDOM" > "key"; chmod 600 "key"
mkdir -p "data"; head -c 300000 /dev/urandom > "data/a.bin"; echo "segredo=1" > "data/env.production"
tar -cf - -C "data" . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:key" -out "p.enc" && ok "criptografou" || bad "criptografia"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:key" -in "p.enc" | tar -tf - >/dev/null && ok "descriptografa e lista" || bad "listagem"
mkdir -p "out"; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:key" -in "p.enc" | tar -xf - -C "out"
cmp -s "data/a.bin" "out/a.bin" && ok "conteudo identico apos a volta" || bad "conteudo diferente"
grep -q 'segredo' "p.enc" && bad "texto claro no .enc" || ok "sem texto claro no .enc"
printf 'outra-chave' > "key2"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:key2" -in "p.enc" 2>/dev/null | tar -tf - >/dev/null 2>&1 && bad "abriu com chave errada" || ok "chave errada nao abre"

cd - >/dev/null
echo "== bk_shred_tree: so dentro da pasta-mae"
mkdir -p "$T/root/.tmp-x/sub"; echo s > "$T/root/.tmp-x/sub/f"
bk_shred_tree "$T/root/.tmp-x" "$T/root" && [ ! -e "$T/root/.tmp-x" ] && ok "apagou a arvore temporaria" || bad "nao apagou"
mkdir -p "$T/fora"; bk_shred_tree "$T/fora" "$T/root" && bad "apagou fora da pasta-mae" || { [ -d "$T/fora" ] && ok "recusou pasta fora da mae"; }
bk_shred_tree "$T/root" "$T/root" && bad "apagou a propria pasta-mae" || ok "recusou pasta == mae"

echo "== bk_json_str"
eq "$(bk_json_str 'a"b\c
d')" 'a\"b\\c d' "escape JSON"

echo "== bk_key_fingerprint (conferir a copia da chave guardada fora do servidor)"
printf '%s' 'chave-de-teste-nao-real' > "$T/k"
fp="$(bk_key_fingerprint "$T/k")"
eq "$fp" "$(printf '%s' 'chave-de-teste-nao-real' | sha256sum | cut -c1-12)" "impressao = sha256 do texto da chave (12 caracteres)"
eq "$(bk_key_fingerprint "$T/nao-existe")" ausente "chave ausente"

echo; [ "$fails" = 0 ] && echo "SELFTEST_BACKUP_OK" || { echo "SELFTEST_BACKUP_FALHOU ($fails)"; exit 1; }
