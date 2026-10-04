#!/usr/bin/env bash
# Funcoes puras do monitor (estado e transicoes). Usado por check.sh e pelo teste. Nao executar diretamente.
# Estado em JSON de uma linha por item (valido como JSON, mas simples de ler sem jq):
#   "nome": {"s":"ok|fail","desde":<epoch>,"aviso":<epoch do ultimo alerta>,"n":<falhas seguidas / contador>}

declare -gA ST_S=() ST_DESDE=() ST_AVISO=() ST_N=()
declare -ga MSGS=()   # mensagens de alerta desta rodada
declare -ga FAILING=() # itens em falha (para o log)

mon_state_load() { # $1 = arquivo
  ST_S=(); ST_DESDE=(); ST_AVISO=(); ST_N=()
  [ -f "$1" ] || return 0
  local line re='^[[:space:]]*"([^"]+)":[[:space:]]*\{"s":"([a-z]+)","desde":([0-9]+),"aviso":([0-9]+),"n":([0-9]+)\}'
  while IFS= read -r line; do
    if [[ "$line" =~ $re ]]; then
      ST_S["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
      ST_DESDE["${BASH_REMATCH[1]}"]="${BASH_REMATCH[3]}"
      ST_AVISO["${BASH_REMATCH[1]}"]="${BASH_REMATCH[4]}"
      ST_N["${BASH_REMATCH[1]}"]="${BASH_REMATCH[5]}"
    fi
  done < "$1"
}

mon_state_save() { # $1 = arquivo (escrita atomica)
  local f="$1" tmp="$1.tmp" k first=1
  {
    printf '{\n'
    for k in $(printf '%s\n' "${!ST_S[@]}" | sort); do
      [ "$first" = 1 ] || printf ',\n'
      first=0
      printf '"%s": {"s":"%s","desde":%s,"aviso":%s,"n":%s}' "$k" "${ST_S[$k]}" "${ST_DESDE[$k]:-0}" "${ST_AVISO[$k]:-0}" "${ST_N[$k]:-0}"
    done
    printf '\n}\n'
  } > "$tmp"
  mv -f "$tmp" "$f"
}

# Decide o que fazer numa checagem. Entradas: estado anterior (ok|fail), epoch do ultimo aviso, epoch atual, estado novo.
# Saida: none | alert_fail | alert_ok | remind   (lembra a cada MON_REMIND_SECS, padrao 6 h, enquanto durar)
mon_decide() {
  local prev="$1" aviso="${2:-0}" now="$3" new="$4" remind="${MON_REMIND_SECS:-21600}"
  if [ "$new" = fail ]; then
    if [ "$prev" != fail ]; then echo alert_fail
    elif [ $((now - aviso)) -ge "$remind" ]; then echo remind
    else echo none; fi
  else
    if [ "$prev" = fail ]; then echo alert_ok; else echo none; fi
  fi
}

mon_dur() { # segundos -> "2h05" / "12 min"
  local s="$1"
  if [ "$s" -ge 3600 ]; then printf '%dh%02d' $((s / 3600)) $(((s % 3600) / 60)); else printf '%d min' $((s / 60)); fi
}

# Registra o resultado de um item. $1 nome, $2 ok|fail, $3 detalhe, $4 falhas seguidas para declarar falha (padrao MON_CONFIRM=2).
# Usa NOW (epoch). Acrescenta em MSGS quando houver transicao/lembrete.
mon_record() {
  local n="$1" r="$2" d="$3" cf="${4:-${MON_CONFIRM:-2}}"
  local ps="${ST_S[$n]:-ok}" pn="${ST_N[$n]:-0}" pa="${ST_AVISO[$n]:-0}" pd="${ST_DESDE[$n]:-$NOW}"
  local ns nn na="$pa" nd="$pd" act
  if [ "$r" = ok ]; then nn=0; ns=ok
  else
    nn=$((pn + 1))
    if [ "$nn" -ge "$cf" ]; then ns=fail; else ns="$ps"; fi
  fi
  act="$(mon_decide "$ps" "$pa" "$NOW" "$ns")"
  [ "$ns" != "$ps" ] && nd="$NOW"
  case "$act" in
    alert_fail) MSGS+=("FALHA: $n - $d"); na="$NOW" ;;
    alert_ok)   MSGS+=("RECUPEROU: $n (ficou $(mon_dur $((NOW - pd))) em falha)"); na=0 ;;
    remind)     MSGS+=("AINDA EM FALHA ha $(mon_dur $((NOW - pd))): $n - $d"); na="$NOW" ;;
  esac
  [ "$ns" = fail ] && FAILING+=("$n: $d")
  ST_S[$n]="$ns"; ST_N[$n]="$nn"; ST_AVISO[$n]="$na"; ST_DESDE[$n]="$nd"
  return 0
}

mon_json_str() { # escapa para string JSON (mantem quebras de linha como \n)
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\r'/}"; s="${s//$'\t'/ }"; s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

# Extrai um valor simples de um JSON compacto (sem jq). $1 = JSON, $2 = chave. Imprime o valor sem aspas.
mon_jget() {
  printf '%s' "$1" | grep -o "\"$2\":[^,}]*" | head -n1 | sed -e 's/^[^:]*://' -e 's/^"//' -e 's/"$//'
}
