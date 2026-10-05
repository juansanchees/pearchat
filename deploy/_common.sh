#!/usr/bin/env bash
# Funcoes comuns dos scripts que rodam NO SEU COMPUTADOR (deploy.sh, deploy-domain.sh, rollback.sh, status.sh).
# Nao executar diretamente. Nenhum endereco, usuario ou caminho de chave fica no repositorio: tudo vem do ambiente ou de
# deploy/.deploy.env (arquivo local, ignorado pelo controle de versao). Modelo: deploy/deploy.env.example.

# Carrega a configuracao e valida. Define HOST, KEY, SSH_USER, DOMAIN, SSH_BASE (opcoes do ssh).
deploy_load_config() {
  # shellcheck disable=SC1091
  [ -f deploy/.deploy.env ] && . deploy/.deploy.env
  HOST="${PEARCHAT_HOST:-}"
  KEY="${PEARCHAT_KEY:-}"
  SSH_USER="${PEARCHAT_USER:-root}"
  DOMAIN="${PEARCHAT_DOMAIN:-pearchat.online}"
  if [ -z "$HOST" ] || [ -z "$KEY" ]; then
    cat >&2 <<'EOF'
ERRO: faltam PEARCHAT_HOST (endereco da VPS) e/ou PEARCHAT_KEY (caminho da chave SSH).
Crie deploy/.deploy.env a partir de deploy/deploy.env.example (o arquivo e ignorado pelo git) ou exporte as variaveis.
EOF
    return 1
  fi
  [ -f "$KEY" ] || { echo "ERRO: chave SSH nao encontrada em $KEY (PEARCHAT_KEY)" >&2; return 1; }
  SSH_BASE=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30)
  return 0
}

# Recusa publicar uma arvore com alteracoes nao commitadas (o que sobe nao seria o que esta no controle de versao).
# Liberar de proposito: DEPLOY_ALLOW_DIRTY=1.
deploy_check_clean_tree() {
  if [ "${DEPLOY_ALLOW_DIRTY:-0}" = 1 ]; then echo "(aviso) DEPLOY_ALLOW_DIRTY=1: publicando com alteracoes nao commitadas"; return 0; fi
  if ! command -v git >/dev/null 2>&1 || ! git rev-parse --git-dir >/dev/null 2>&1; then return 0; fi
  if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    echo "ERRO: ha alteracoes nao commitadas. Faça commit antes de publicar (ou DEPLOY_ALLOW_DIRTY=1 para forcar)." >&2
    return 1
  fi
  # Aviso (nao bloqueia): commit que ainda nao foi para nenhum remoto.
  if [ -z "$(git branch -r --contains HEAD 2>/dev/null)" ]; then echo "(aviso) o commit publicado ainda nao esta em nenhum remoto (git push)"; fi
  return 0
}

# Envia o codigo por tar (SEM segredos, SEM o ambiente do servidor) e dispara um comando remoto. $1 = comando remoto.
# Antes de extrair, o servidor guarda o compose e o Caddyfile em uso como *.previous (base da reversao).
# O arquivo de ambiente do SERVIDOR (deploy/.env.production) nunca e enviado nem sobrescrito.
deploy_upload_and_run() {
  local remote_cmd="$1"
  tar czf - \
    --exclude=node_modules --exclude=.next --exclude=.git --exclude='.env*' --exclude='*.bak-*' \
    --exclude='deploy/.deploy.env' --exclude='deploy/.validate.env' --exclude='./docker-compose.yml' \
    --exclude=docs --exclude=tests --exclude=.github --exclude='*.log' --exclude='*.tsbuildinfo' \
    --exclude=next-env.d.ts --exclude=.claude . \
  | ssh "${SSH_BASE[@]}" "$SSH_USER@$HOST" "mkdir -p /opt/pearchat && cd /opt/pearchat && for f in docker-compose.prod.yml Caddyfile; do [ -f deploy/\$f ] && cp -p deploy/\$f deploy/\$f.previous; done; rm -rf src prisma docker public scripts && tar xzf - -C /opt/pearchat || { echo UPLOAD_FALHOU; exit 1; }; $remote_cmd"
}
