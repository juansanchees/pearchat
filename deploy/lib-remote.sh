#!/usr/bin/env bash
# Funcoes compartilhadas por remote.sh e remote-rollback.sh. Rodam NA VPS. Nao executar diretamente.
# Nada aqui imprime valores de segredos.

APP_DIR="${APP_DIR:-/opt/pearchat}"
ENVF="${ENVF:-deploy/.env.production}"
C="${C:-docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file $ENVF}"
APP="${APP:-pearchat-app-1}"
CADDY="${CADDY:-pearchat-caddy-1}"
EVO="${EVO:-pearchat-evolution-1}"

# Valor de uma chave do arquivo de ambiente do servidor (sem aspas). Uso: envval CHAVE
envval() {
  grep -m1 "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2- | sed -e "s/^'//" -e "s/'\$//" -e 's/^"//' -e 's/"$//'
}

# Dominio publico (host de AUTH_URL), com padrao seguro.
deploy_domain() {
  local u h
  u="$(envval AUTH_URL)"
  h="${u#*://}"; h="${h%%/*}"; h="${h%%:*}"
  printf '%s' "${h:-pearchat.online}"
}

# Migracoes (prisma migrate deploy). Com MIGRATE_DATABASE_URL no ambiente do servidor (papel DONO do schema, ver
# docs/operacao/supabase.md) as migracoes usam esse papel e o app segue com o papel restrito da DATABASE_URL. Sem a variavel,
# usa a DATABASE_URL (comportamento atual). A URL passa por variavel de ambiente, nunca na linha de comando. $1 = run | exec.
migrate_run() {
  local m; m="$(envval MIGRATE_DATABASE_URL)"
  if [ -n "$m" ]; then
    echo "(migracoes com MIGRATE_DATABASE_URL: papel dono do schema)"
    if [ "$1" = run ]; then DATABASE_URL="$m" $C run --rm --no-deps -T -e DATABASE_URL app npx prisma migrate deploy
    else DATABASE_URL="$m" $C exec -T -e DATABASE_URL app npx prisma migrate deploy; fi
  elif [ "$1" = run ]; then $C run --rm --no-deps -T app npx prisma migrate deploy
  else $C exec -T app npx prisma migrate deploy; fi
}

# Espera o healthcheck do app ficar "healthy". $1 = tentativas de 5 s (padrao 120 = 10 min).
wait_app_healthy() {
  local n="${1:-120}" st=starting i
  for i in $(seq 1 "$n"); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo missing)"
    [ "$st" = healthy ] && break
    sleep 5
  done
  echo "app health: $st"
  [ "$st" = healthy ]
}

# Verificacao pos-troca (fumaca), toda por HTTP interno (127.0.0.1) e docker inspect: sem SSH, sem login real.
#  1) /api/health: ok:true e, com HEALTH_TOKEN, versao == commit enviado (.deploy-commit);
#  2) /login = 200; /api/auth/csrf devolve um csrfToken; /api/auth/session = 200 (o Auth.js responde, banco acessivel);
#  3) Caddy rodando e respondendo https local (resolve do dominio para 127.0.0.1), com /api/dev/* bloqueado (404);
#  4) Evolution: container rodando, sem reiniciar durante a janela (derruba o WhatsApp se ficar em laco).
# Tenta por ate $1 segundos (padrao 150). Retorna 0 se tudo certo; 1 caso contrario (o motivo vai para o log).
smoke_check() {
  local budget="${1:-150}" t0=$SECONDS port tok want domain h hok login csrf sess caddy_st code dev why=""
  local evo_rc0 evo_rc evo_st evo_rs settled=0
  port="$(envval PEARCHAT_PORT)"; port="${port:-8088}"
  tok="$(envval HEALTH_TOKEN)"
  want="$(tr -d '[:space:]' < .deploy-commit 2>/dev/null | cut -c1-12)"
  domain="$(deploy_domain)"
  evo_rc0="$(docker inspect -f '{{.RestartCount}}' "$EVO" 2>/dev/null || echo 0)"
  while :; do
    why=""
    if [ -n "$tok" ]; then h="$(curl -s -m 8 -H "x-health-token: $tok" "http://127.0.0.1:$port/api/health" 2>/dev/null)"
    else h="$(curl -s -m 8 "http://127.0.0.1:$port/api/health" 2>/dev/null)"; fi
    hok=0
    case "$h" in *'"ok":true'*) hok=1 ;; esac
    [ "$hok" = 1 ] || why="$why /api/health sem ok:true;"
    if [ "$hok" = 1 ] && [ -n "$tok" ] && [ "${SMOKE_SKIP_VERSION:-0}" != 1 ] && [[ "$want" =~ ^[0-9a-f]{12}$ ]]; then
      case "$h" in *"\"versao\":\"$want\""*) ;; *) why="$why versao em execucao diferente do commit enviado ($want);" ;; esac
    fi
    login="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "http://127.0.0.1:$port/login" 2>/dev/null)"
    [ "$login" = 200 ] || why="$why /login HTTP ${login:-000};"
    csrf="$(curl -s -m 8 "http://127.0.0.1:$port/api/auth/csrf" 2>/dev/null)"
    case "$csrf" in *csrfToken*) ;; *) why="$why /api/auth/csrf sem csrfToken;" ;; esac
    sess="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "http://127.0.0.1:$port/api/auth/session" 2>/dev/null)"
    [ "$sess" = 200 ] || why="$why /api/auth/session HTTP ${sess:-000};"
    caddy_st="$(docker inspect -f '{{.State.Status}}' "$CADDY" 2>/dev/null || echo missing)"
    if [ "$caddy_st" != running ]; then why="$why caddy $caddy_st;"
    else
      code="$(curl -sk -m 8 --resolve "$domain:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$domain/login" 2>/dev/null)"
      [ "$code" = 200 ] || why="$why https local /login HTTP ${code:-000};"
      # Regra nova da borda (so confere na troca; na reversao o Caddyfile antigo pode nao ter a regra).
      if [ "${SMOKE_SKIP_VERSION:-0}" != 1 ]; then
        dev="$(curl -sk -m 8 --resolve "$domain:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$domain/api/dev/engine/tick" 2>/dev/null)"
        [ "$dev" = 404 ] || why="$why borda nao bloqueou /api/dev (HTTP ${dev:-000});"
      fi
    fi
    evo_st="$(docker inspect -f '{{.State.Status}}' "$EVO" 2>/dev/null || echo missing)"
    evo_rs="$(docker inspect -f '{{.State.Restarting}}' "$EVO" 2>/dev/null || echo false)"
    evo_rc="$(docker inspect -f '{{.RestartCount}}' "$EVO" 2>/dev/null || echo 0)"
    if [ "$evo_st" != running ] || [ "$evo_rs" = true ]; then why="$why evolution $evo_st (restarting=$evo_rs);"
    elif [ "${evo_rc:-0}" -gt "${evo_rc0:-0}" ] 2>/dev/null; then why="$why evolution reiniciou durante a verificacao;"
    else
      # Rede interna (redes separadas no compose): a Evolution precisa alcancar o app (webhook de mensagens recebidas, que a
      # borda NAO deixa passar pela internet) e o app precisa alcancar a Evolution. Sem isto o WhatsApp ficaria "conectado" e mudo.
      if ! timeout 15 docker exec "$EVO" node -e "fetch('http://app:3000/api/health').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
        why="$why evolution nao alcanca o app em http://app:3000 (rede interna/webhook);"
      fi
      if ! timeout 15 docker exec "$APP" node -e "fetch('http://evolution:8080/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
        why="$why app nao alcanca a evolution em http://evolution:8080;"
      fi
    fi
    if [ -z "$why" ]; then
      # Duas passadas verdes separadas por 25 s: pega container em laco de reinicio que "parece" de pe por instantes.
      if [ "$settled" = 0 ]; then settled=1; sleep 25; continue; fi
      echo "verificacao pos-troca: OK ($((SECONDS - t0))s)"; return 0
    fi
    settled=0
    if [ $((SECONDS - t0)) -ge "$budget" ]; then echo "verificacao pos-troca: FALHOU:$why"; return 1; fi
    sleep 5
  done
}
