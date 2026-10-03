#!/usr/bin/env bash
# Roda NA VPS (disparado por deploy/remote.sh, dentro da conexao SSH unica), ANTES de subir o PearChat novo.
# 1) INVENTARIO do Zapfloo (so leitura)  -> /opt/pearchat/deploy/zapfloo-inventory.txt
# 2) PARA os containers do Zapfloo (docker update --restart=no + docker stop). Nao apaga nada.
# 3) Libera as portas 80/443 e comenta os crons do Zapfloo (backup do crontab antes).
# 4) Gera /opt/pearchat/deploy/zapfloo-delete-commands.txt com os comandos de exclusao definitiva (o script NAO os executa).
# Idempotente. Termina com ZAPFLOO_STOP_RESULT=ok  ou  ZAPFLOO_STOP_RESULT=fail <motivo>.
export LC_ALL=C
DEP=/opt/pearchat/deploy
INV="$DEP/zapfloo-inventory.txt"
DEL="$DEP/zapfloo-delete-commands.txt"
TS="$(date +%Y%m%d-%H%M%S)"
FAIL=""
PAT='zapfloo|deskcomm|event-log-drain|kit[-_ ./]*update|update[-_ ./]*kit'
PROTECTED_IMG='^(caddy|postgres|redis|evoapicloud/evolution-api|pearchat-app)(:|$)'
mkdir -p "$DEP"

# Mascara tokens/segredos em qualquer texto que passe por aqui.
mask() { sed -E 's/(Bearer )[^[:space:]"]+/\1***/Ig; s/((token|secret|key)=)[^[:space:]&"]+/\1***/Ig'; }
hs() { numfmt --to=iec "$1" 2>/dev/null || echo "${1}B"; }
fail() { FAIL="${FAIL:+$FAIL; }$1"; }

if ! docker info >/dev/null 2>&1; then
  echo "docker indisponivel"
  echo "ZAPFLOO_STOP_RESULT=fail docker_indisponivel"
  exit 1
fi

# ---------- descoberta (nao assume nomes) ----------
ZC="$(docker ps -a --filter name=zapfloo --format '{{.Names}}' | grep -v '^pearchat-')"
ZPROJ=""
for c in $ZC; do
  p="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null)"
  [ -n "$p" ] && [ "$p" != pearchat ] && ZPROJ="$ZPROJ $p"
done
ZPROJ="$(printf '%s\n' $ZPROJ | sort -u | xargs)"
ALLC="$ZC"
for p in $ZPROJ; do
  ALLC="$ALLC
$(docker ps -a --filter "label=com.docker.compose.project=$p" --format '{{.Names}}')"
done
ALLC="$(printf '%s\n' "$ALLC" | grep -v '^$' | grep -v '^pearchat-' | sort -u)"
ZDIR=""
for c in $ALLC; do
  d="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"
  if [ -n "$d" ]; then ZDIR="$d"; break; fi
done

ZVOLS=""
for p in $ZPROJ; do ZVOLS="$ZVOLS $(docker volume ls -q --filter "label=com.docker.compose.project=$p")"; done
ZNETS=""
for p in $ZPROJ; do ZNETS="$ZNETS $(docker network ls --filter "label=com.docker.compose.project=$p" --format '{{.Name}}')"; done
for c in $ALLC; do
  ZVOLS="$ZVOLS $(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$c" 2>/dev/null)"
  ZNETS="$ZNETS $(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c" 2>/dev/null)"
done
ZVOLS="$(printf '%s\n' $ZVOLS | grep -v '^$' | grep -v '^pearchat_' | sort -u)"
ZNETS="$(printf '%s\n' $ZNETS | grep -v '^$' | grep -vE '^(bridge|host|none|pearchat_net)$' | sort -u)"

is_zap_line() {
  printf '%s\n' "$1" | grep -qiE "$PAT" && return 0
  [ -n "$ZDIR" ] && printf '%s\n' "$1" | grep -qF "$ZDIR" && return 0
  return 1
}

# ---------- 1) INVENTARIO (somente leitura; nunca imprime .env) ----------
{
  echo "# Inventario do Zapfloo - $(date -u +%FT%TZ)"
  echo "projetos compose: ${ZPROJ:-<nenhum>}"
  echo "diretorio de trabalho: ${ZDIR:-<desconhecido>}"
  echo
  echo "## docker ps -a (nome contendo zapfloo)"
  docker ps -a --filter name=zapfloo --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Size}}'
  echo
  echo "## containers do(s) projeto(s)"
  for c in $ALLC; do
    echo "- $c  [$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)]"
    echo "    project:      $(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null)"
    echo "    working_dir:  $(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)"
    echo "    config_files: $(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$c" 2>/dev/null)"
    echo "    imagem:       $(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null)"
    echo "    restart:      $(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c" 2>/dev/null)"
    echo "    mounts:"
    docker inspect -f '{{range .Mounts}}      {{.Type}} {{.Name}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' "$c" 2>/dev/null
  done
  echo
  echo "## volumes (projeto + montados pelos containers)"
  for v in $ZVOLS; do
    mp="$(docker volume inspect -f '{{.Mountpoint}}' "$v" 2>/dev/null)"
    echo "- $v  $(du -sh "$mp" 2>/dev/null | cut -f1)  $mp"
  done
  echo
  echo "## redes"
  for n in $ZNETS; do echo "- $n"; done
  echo
  echo "## imagens usadas pelos containers do Zapfloo"
  for c in $ALLC; do
    r="$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null)"
    s="$(docker image inspect -f '{{.Size}}' "$r" 2>/dev/null)"
    echo "- $r  $( [ -n "$s" ] && hs "$s" || echo '?')  (container $c)"
  done
  echo
  echo "## docker system df"
  docker system df
  echo
  echo "## df -h /"
  df -h /
  echo
  echo "## du: diretorio de trabalho do compose do Zapfloo"
  [ -n "$ZDIR" ] && du -sh "$ZDIR" 2>/dev/null
  echo
  echo "## du: 25 maiores diretorios de / (ate 2 niveis)"
  du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -25
  echo
  echo "## crontab do root: linhas relacionadas (tokens mascarados)"
  crontab -l 2>/dev/null | while IFS= read -r l; do is_zap_line "$l" && printf '%s\n' "$l"; done
  echo
  echo "## /etc/cron.d: arquivos relacionados"
  for f in /etc/cron.d/*; do
    [ -f "$f" ] || continue
    if grep -qiE "$PAT" "$f" 2>/dev/null || { [ -n "$ZDIR" ] && grep -qF "$ZDIR" "$f" 2>/dev/null; }; then
      echo "- $f"
      grep -iE "$PAT" "$f" 2>/dev/null
    fi
  done
  echo
  echo "## systemd (servicos com zapfloo/deskcomm no nome; apenas informativo, NAO alterados)"
  systemctl list-units --all --type=service --no-pager --no-legend 2>/dev/null | grep -iE 'zapfloo|deskcomm'
  systemctl list-unit-files --type=service --no-pager --no-legend 2>/dev/null | grep -iE 'zapfloo|deskcomm'
  echo "## fim do inventario"
} 2>&1 | mask | tee "$INV"
chmod 600 "$INV" 2>/dev/null

# ---------- 2) PARAR (sem down/rm/rmi/prune) ----------
echo
echo "== parando containers do Zapfloo (sem apagar nada) =="
if [ -z "$ALLC" ]; then
  echo "nenhum container do Zapfloo encontrado (ja removido ou nunca existiu); nada a parar"
fi
for c in $ALLC; do
  docker update --restart=no "$c" >/dev/null 2>&1 || fail "update_restart_$c"
  docker stop -t 30 "$c" >/dev/null 2>&1
  st="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)"
  echo "$c -> $st (restart=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c" 2>/dev/null))"
  [ "$st" = running ] && fail "container_${c}_ainda_rodando"
done

# ---------- portas 80/443 livres? ----------
echo
echo "== portas 80/443 =="
if docker ps --format '{{.Names}}' | grep -qx pearchat-caddy-1; then
  echo "pearchat-caddy-1 ja esta ativo (nova execucao); verificacao de porta ignorada"
else
  L=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    L="$(ss -ltnp 2>/dev/null | awk 'NR>1 && $4 ~ /:(80|443)$/')"
    [ -z "$L" ] && break
    sleep 2
  done
  if [ -n "$L" ]; then
    echo "AINDA OCUPADAS:"
    printf '%s\n' "$L"
    fail "portas_80_443_ocupadas"
  else
    echo "80 e 443 livres"
  fi
fi

# ---------- 3) CRON ----------
echo
echo "== cron =="
CT="$(mktemp)"; NEW="$(mktemp)"
if crontab -l > "$CT" 2>/dev/null; then
  CHANGED=0
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ ! "$line" =~ ^[[:space:]]*# ]] && [ -n "${line//[[:space:]]/}" ] && is_zap_line "$line"; then
      printf '#PEARCHAT-DISABLED# %s\n' "$line" >> "$NEW"
      CHANGED=1
      printf 'linha de crontab desabilitada: %s\n' "$line" | mask
    else
      printf '%s\n' "$line" >> "$NEW"
    fi
  done < "$CT"
  if [ "$CHANGED" = 1 ]; then
    cp -p "$CT" "/root/crontab.bak-pearchat-$TS" && echo "backup do crontab: /root/crontab.bak-pearchat-$TS"
    crontab "$NEW" || fail "crontab_nao_gravou"
  else
    echo "crontab do root: nada a desabilitar"
  fi
else
  echo "root sem crontab"
fi
rm -f "$CT" "$NEW"
for f in /etc/cron.d/*; do
  [ -f "$f" ] || continue
  case "$f" in *.disabled-by-pearchat) continue ;; esac
  if grep -qiE "$PAT" "$f" 2>/dev/null || { [ -n "$ZDIR" ] && grep -qF "$ZDIR" "$f" 2>/dev/null; }; then
    mv "$f" "$f.disabled-by-pearchat" && echo "cron.d desabilitado: $f -> $f.disabled-by-pearchat" || fail "cron_d_$f"
  fi
done

# ---------- 4) comandos de exclusao definitiva (apenas ESCRITOS, nunca executados) ----------
OTHER_IDS="$(for c in $(docker ps -a --format '{{.Names}}'); do
  printf '%s\n' "$ALLC" | grep -qx "$c" && continue
  docker inspect -f '{{.Image}}' "$c" 2>/dev/null
done | sort -u)"
IMGREFS="$( { for c in $ALLC; do docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null; done
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -iE '^ghcr\.io/juansanchees/zapfloo-'; } | grep -v '^$' | sort -u)"
BCACHE="$(docker system df --format '{{.Type}}|{{.Size}}|{{.Reclaimable}}' 2>/dev/null | grep -i 'build cache' | head -1)"
{
  echo "# Comandos para APAGAR EM DEFINITIVO o que e do Zapfloo. Gerado em $(date -u +%FT%TZ)."
  echo "# NADA daqui foi executado. Rode manualmente (uma conexao SSH), conferindo antes o zapfloo-inventory.txt."
  echo "# So faca isso se o Zapfloo estiver mesmo aposentado: sem volta."
  echo
  if [ -n "$ALLC" ]; then
    echo "# Remove os containers PARADOS do Zapfloo ($(printf '%s\n' "$ALLC" | wc -l) container(s)); libera pouco espaco (camadas de escrita)."
    echo "docker rm $(printf '%s ' $ALLC)"
    echo
  fi
  for v in $ZVOLS; do
    mp="$(docker volume inspect -f '{{.Mountpoint}}' "$v" 2>/dev/null)"
    echo "# Apaga o volume $v (DADOS do Zapfloo); libera cerca de $(du -sh "$mp" 2>/dev/null | cut -f1)."
    echo "docker volume rm $v"
    echo
  done
  for r in $IMGREFS; do
    id="$(docker image inspect -f '{{.Id}}' "$r" 2>/dev/null)"
    s="$(docker image inspect -f '{{.Size}}' "$r" 2>/dev/null)"
    sz="$( [ -n "$s" ] && hs "$s" || echo '?')"
    if printf '%s\n' "$r" | grep -qE "$PROTECTED_IMG"; then
      echo "# NAO apagar $r: imagem compartilhada com o PearChat ($sz)."
    elif [ -n "$id" ] && printf '%s\n' "$OTHER_IDS" | grep -qx "$id"; then
      echo "# NAO apagar $r: usada tambem por outro container ($sz)."
    else
      echo "# Apaga a imagem $r; libera cerca de $sz."
      echo "docker rmi $r"
    fi
    echo
  done
  for n in $ZNETS; do
    echo "# Apaga a rede Docker $n; nao libera espaco."
    echo "docker network rm $n"
    echo
  done
  if [ -n "$ZDIR" ] && [ "$ZDIR" != "/" ] && [ "$ZDIR" != "/opt/pearchat" ] && [ "$ZDIR" != "/root" ]; then
    echo "# Apaga o diretorio de trabalho do compose do Zapfloo ($ZDIR), inclusive .env; libera cerca de $(du -sh "$ZDIR" 2>/dev/null | cut -f1)."
    echo "rm -rf $ZDIR"
    echo
  fi
  echo "# Limpa o cache de build do Docker (inclui o do PearChat: o proximo build sera mais lento); libera cerca de $(printf '%s' "$BCACHE" | cut -d'|' -f3 | sed 's/ (.*//;s/^$/?/') (total do cache: $(printf '%s' "$BCACHE" | cut -d'|' -f2))."
  echo "docker builder prune -af"
  echo
  echo "# Apaga os backups de crontab criados pelo zapfloo-stop.sh (so depois de confirmar que nao quer religar o Zapfloo)."
  echo "rm -f /root/crontab.bak-pearchat-*"
  echo
  echo "# Apaga os arquivos de /etc/cron.d desabilitados pelo zapfloo-stop.sh; espaco irrisorio."
  echo "rm -f /etc/cron.d/*.disabled-by-pearchat"
  echo
  echo "# Opcional: remove imagens dangling restantes; libera o que 'docker system df' mostrar como reclaimable em Images."
  echo "docker image prune -f"
} > "$DEL" 2>/dev/null
chmod 600 "$DEL" 2>/dev/null
echo
echo "comandos de exclusao (NAO executados) gravados em $DEL"

# ---------- resultado ----------
if [ -n "$FAIL" ]; then
  echo "ZAPFLOO_STOP_RESULT=fail $FAIL"
  exit 1
fi
echo "ZAPFLOO_STOP_RESULT=ok"
exit 0
