# Servidor (VPS): verificar e endurecer, sem se trancar para fora

Tudo aqui é feito **no servidor**, por SSH. O PearChat **não faz nada disso sozinho** (de propósito: mexer em SSH e firewall pelo deploy poderia te trancar para fora). Para cada item: primeiro o comando de **verificação** (só leitura, não muda nada) e depois o de **correção**.

## Regras para não se trancar para fora

1. **Mantenha uma sessão SSH aberta** enquanto testa outra. Só feche a primeira depois de confirmar que a segunda entrou.
2. Tenha à mão o **console web do provedor da VPS** (painel do provedor → "Console"/"VNC"). Ele entra mesmo com o SSH quebrado.
3. O servidor limita as conexões SSH (cerca de 1 por hora). **Junte os comandos de verificação num único login.**
4. Não cole senhas, chaves nem o conteúdo do `.env.production` em chats ou e-mails.

## 0. Verificação geral (um login só, só leitura)

Cole tudo de uma vez, como administrador (`root`), e guarde a saída para comparar depois:

```bash
echo "== SSH"; sshd -T 2>/dev/null | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication|kbdinteractiveauthentication|maxauthtries|port) '
echo "== Firewall"; ufw status verbose 2>&1 | head -20
echo "== fail2ban"; (fail2ban-client status sshd 2>&1 || echo "fail2ban ausente") | head
echo "== Portas escutando"; ss -lntup | awk 'NR==1 || /LISTEN|UNCONN/'
echo "== Contêineres"; docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo "== Atualizações automáticas"; systemctl is-active unattended-upgrades 2>&1; ls /var/run/reboot-required 2>&1
echo "== Hora"; timedatectl | grep -E 'Time zone|synchronized|NTP'
echo "== Memória / disco"; free -h; df -h /; docker system df
echo "== Volumes e imagens (sobras do Zapfloo?)"; docker volume ls; docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}'
echo "== Permissões de arquivos sensíveis"; stat -c '%a %U %n' /opt/pearchat/deploy/.env.production /root/.pearchat-backup-key /etc/pearchat-backup.conf /etc/pearchat-monitor.conf 2>&1
echo "== Chaves SSH autorizadas"; wc -l /root/.ssh/authorized_keys
echo "== Falhas de login SSH nas últimas 24 h"; journalctl -u ssh --since '24 hours ago' 2>/dev/null | grep -c 'Failed password'
```

**Como ler:** `passwordauthentication no` e `permitrootlogin prohibit-password` é o desejado; `ss` deve mostrar escuta em `0.0.0.0` só nas portas **22, 80 e 443**; os arquivos sensíveis devem ter `600`.

## 1. SSH só por chave

**Verificar:** `sshd -T | grep -E 'passwordauthentication|permitrootlogin'` (veja a seção 0).

**Corrigir** (só se hoje você entra **por chave** e já testou):

```bash
cat > /etc/ssh/sshd_config.d/00-pearchat-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
EOF
sshd -t && systemctl reload ssh        # em algumas distribuições o serviço se chama "sshd"
```

**Risco:** se a chave não funcionar, você se tranca. **Antes de fechar a sessão atual, abra OUTRA e confirme que entra pela chave.** Para desfazer: apague o arquivo acima e `systemctl reload ssh` (pelo console web do provedor, se preciso).

## 2. Firewall: só as portas 22, 80 e 443

**Verificar:** `ufw status verbose`. Veja também se o painel do provedor tem um firewall próprio.

**Corrigir** (a ordem importa: **libere o SSH ANTES de ativar**):

```bash
apt-get update && apt-get install -y ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable && ufw status verbose
```

**Riscos:** se o SSH não estiver na porta 22, ajuste a regra antes de ativar. **Atenção:** o Docker ignora o `ufw` para as portas que ele mesmo publica. Hoje só o Caddy (80/443) publica portas; **nunca publique outra porta no compose** sem pensar nisso.

## 3. fail2ban (bloqueia quem erra a senha/chave várias vezes)

**Verificar:** `fail2ban-client status sshd`.

**Corrigir:**

```bash
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.d/pearchat.local <<'EOF'
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban && fail2ban-client status sshd
```

**Risco:** ele pode bloquear você mesmo se errar várias vezes (use o console web do provedor). Se você tem IP fixo, acrescente `ignoreip = 127.0.0.1/8 ::1 SEU.IP.AQUI` no arquivo.

## 4. Atualizações automáticas de segurança

**Verificar:** `systemctl is-active unattended-upgrades` (deve dizer `active`) e `ls /var/run/reboot-required` (se existir, há atualização que pede reinício).

**Corrigir:**

```bash
apt-get install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
grep -E 'Automatic-Reboot' /etc/apt/apt.conf.d/50unattended-upgrades      # deixe "false" e reinicie você mesmo quando precisar
```

**Risco:** atualização de kernel só vale depois de reiniciar o servidor (o site fica fora do ar 1 a 2 minutos e o WhatsApp volta sozinho). Escolha um horário calmo.

## 5. Contêineres e dados órfãos (o Zapfloo antigo)

**Verificar:** `docker ps -a`, `docker volume ls`, `docker images`. Qualquer coisa que **não** comece com `pearchat` é sobra. Veja também `/opt/pearchat/deploy/zapfloo-delete-commands.txt` (lista de comandos gerada, **nunca executada sozinha**).

**Corrigir:** só depois de confirmar que o Zapfloo não será mais usado e de **guardar um backup final fora da VPS**: abra o arquivo, leia, e execute linha a linha só o que for do Zapfloo. **Apagar é irreversível.** Troque também as chaves que o Zapfloo usava.

## 6. Arquivos sensíveis com permissão certa

**Verificar:** a saída da seção 0 (`stat`). **Corrigir:**

```bash
chmod 600 /opt/pearchat/deploy/.env.production /root/.pearchat-backup-key /etc/pearchat-backup.conf /etc/pearchat-monitor.conf
chmod 700 /opt/pearchat-backups
```

## 7. Opcionais (quando houver tempo)

- **Relógio:** `timedatectl set-ntp true` (a hora errada atrapalha certificados e o código de 2 etapas).
- **Memória extra (swap)**, se `free -h` mostrar swap 0 e a máquina tiver pouca RAM: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`.
- **Usuário de deploy (sem ser `root`):** crie `adduser --disabled-password --gecos '' deploy && usermod -aG docker deploy`, copie a chave para `/home/deploy/.ssh/authorized_keys` e aponte o `PEARCHAT_USER` do `deploy/.deploy.env` para ele. **Teste tudo com `deploy` antes** de desligar o login do `root` (`PermitRootLogin no`). Quem está no grupo `docker` equivale a administrador: o ganho é poder revogar a chave do deploy sem mexer na chave de emergência.
- **Rate limit na borda (limite de requisições por IP):** a imagem oficial do Caddy **não traz** esse recurso (exige um módulo extra, que pediria trocar a imagem). Não foi feito nesta etapa. A alternativa simples e gratuita é colocar a **Cloudflare** na frente do domínio (ela traz limite de requisições e proteção contra robôs). Se for fazer: me avise antes, porque o Caddy precisa ser ajustado para confiar nos endereços dela e as portas 80/443 da VPS devem aceitar só os IPs da Cloudflare.

## O que o repositório já faz por você (não precisa mexer)

O Caddy: HSTS com subdomínios, limite de tamanho por rota, tempos-limite, bloqueio de `/api/dev`, `/api/wa/mock`, `/api/wa/evolution` e `/_next/image`, WebSocket só em `/api/socket`, log de acesso sem senhas, cookies nem `?token=`. O compose: contêineres sem privilégios extras, logs que giram (10 MB × 3), limite de memória e de processos, redes separadas (o Caddy não enxerga o banco da Evolution nem o Redis). Os arquivos estão em `deploy/Caddyfile` e `deploy/docker-compose.prod.yml`.
