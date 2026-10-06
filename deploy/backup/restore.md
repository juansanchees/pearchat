# Roteiro de restauração do PearChat

Backup que nunca foi restaurado é uma hipótese. Este roteiro tem três partes: **A) teste mensal** (não toca na produção), **B) erro no banco** (voltar o schema) e **C) VPS perdida** (reconstruir tudo numa máquina nova). O comando é sempre o `restore.sh` desta pasta; ele é interativo e nunca age sem você digitar uma confirmação.

## O que o backup guarda (e o que ele NÃO guarda)

Guarda, num pacote `pearchat-AAAA-MM-DD_HHMM.tar.enc` (AES-256, chave em `/root/.pearchat-backup-key`): dump do schema `pearchat` do Supabase; dump do banco da Evolution; volumes `pearchat_media` (mídia das conversas), `pearchat_evolution_instances` (sessões do WhatsApp) e `pearchat_caddy_data` (certificados); o `.env.production` (com a `ENCRYPTION_KEY`); cópias de `/etc/pearchat-backup.conf` e `/etc/pearchat-monitor.conf` (destino externo e canais de alerta); e a lista das imagens em uso.

**NÃO guarda** (e por isso você precisa ter a parte): (1) a **chave do backup** — se ela só existir no servidor, a VPS perdida leva a chave junto e nenhum pacote abre; (2) a **credencial do rclone** (`~/.config/rclone/rclone.conf`); (3) o schema `public` do Supabase (outro produto); (4) o código (está no GitHub); (5) o DNS e as contas de terceiros (Supabase, Resend, Meta, OpenAI).

### O que você precisa guardar FORA do servidor (faça hoje)

1. **A chave do backup**: `cat /root/.pearchat-backup-key` → gerenciador de senhas + uma cópia impressa guardada em local seguro. Para conferir depois que a cópia está certa, compare a impressão digital: `sha256sum /root/.pearchat-backup-key | cut -c1-12` no servidor deve ser igual a `printf '%s' '<a chave que você guardou>' | sha256sum | cut -c1-12` no seu computador (e ao campo `chaveImpressao` de `/opt/pearchat-backups/last-status.json`).
2. **A credencial do destino externo** (token do Backblaze/Drive/S3 usado no `rclone config`): no gerenciador de senhas.
3. **Acesso ao Supabase** (e-mail da conta + 2FA) e à conta do provedor da VPS.

## A) Teste mensal (dura ~10 min, não toca na produção)

No servidor, como root:

```bash
cd /opt/pearchat
bash deploy/backup/restore.sh --verify            # escolha o pacote mais recente; deve terminar em VERIFY_OK
bash deploy/backup/restore.sh AAAA-MM-DD_HHMM     # restaura o banco do app num schema NOVO (pearchat_restore_AAAAMMDD)
```

O segundo comando pede que você digite o nome do schema novo, restaura e mostra a **conferência**: quantas linhas há em Organization, Workspace, User, Contact, Conversation, Message, WhatsAppSession e Event. Compare com o app (os números devem ser próximos, de até 24 h atrás). Se quiser olhar pelo painel do Supabase (SQL Editor):

```sql
select count(*) from pearchat_restore_20261004."Contact";
```

**Restaurar "num schema de teste para conferir" é exatamente isto**: o schema `pearchat` de produção não é tocado. Quando terminar, apague o schema de teste (no SQL Editor; é o único passo manual e irreversível, e só do schema de teste):

```sql
DROP SCHEMA pearchat_restore_20261004 CASCADE;
```

Para testar também o pacote que está na **nuvem** (e não o local): baixe-o primeiro (parte C, passo 5) e rode `--verify` nele. Registre a data do teste.

## B) Erro no banco do app (schema `pearchat` danificado ou apagado)

1. Avise os usuários, se for o caso, e **faça um backup agora do que ainda existe**: `bash deploy/backup/backup.sh`.
2. Pare o app: `docker stop pearchat-app-1`.
3. `bash deploy/backup/restore.sh --overwrite AAAA-MM-DD_HHMM`. Ele pede o nome do schema e a palavra `SOBRESCREVER`; **renomeia** (não apaga) o schema atual para `pearchat_antes_<data>` e restaura o do backup.
4. Suba o app: `docker start pearchat-app-1` e confira o login e as conversas. O schema `pearchat_antes_<data>` fica como rede de segurança; apague só quando tiver certeza.
5. Se o dano também atingiu as sessões do WhatsApp: acrescente `--evolution` e `--volumes` (pare antes os contêineres que usam cada volume: `docker stop pearchat-evolution-1`).

Perda máxima: o que entrou depois do backup (até 24 h).

## C) VPS perdida: reconstruir numa máquina nova (RTO realista: 3 a 8 h)

Pré-requisitos: **a chave do backup** (guardada fora), **o pacote da nuvem** e acesso ao DNS.

1. **VPS nova** (mesmo sistema, Ubuntu LTS). Siga `docs/operacao/servidor.md` para o básico (SSH por chave, firewall 22/80/443, atualizações). Instale Docker e o plugin compose.
2. **Código**: `git clone <repositório> /opt/pearchat` (ou envie com `deploy/deploy.sh` depois de ter o `.env.production`, passo 6).
3. **Chave**: grave a chave guardada em `/root/.pearchat-backup-key` com `chmod 600` (`printf '%s' '<chave>' > /root/.pearchat-backup-key`).
4. **rclone**: instale (`curl https://rclone.org/install.sh | bash`) e configure o mesmo destino (`rclone config`), com a credencial que você guardou.
5. **Baixe o pacote mais recente**:
   ```bash
   rclone lsd SEUREMOTE:SEUBUCKET/pearchat                      # lista as pastas AAAA-MM-DD_HHMM
   mkdir -p /opt/pearchat-backups && chmod 700 /opt/pearchat-backups
   rclone copy SEUREMOTE:SEUBUCKET/pearchat/AAAA-MM-DD_HHMM /opt/pearchat-backups/AAAA-MM-DD_HHMM
   bash /opt/pearchat/deploy/backup/restore.sh --verify AAAA-MM-DD_HHMM      # tem que terminar em VERIFY_OK
   ```
6. **Ambiente**: extraia o `.env.production` do pacote: `bash /opt/pearchat/deploy/backup/restore.sh --verify --extract-env /opt/pearchat/deploy AAAA-MM-DD_HHMM`. Confira com `chmod 600 /opt/pearchat/deploy/.env.production`. Se o IP mudou, nada no arquivo depende dele (a URL é o domínio). Ele traz também os `etc-pearchat-*.conf` (copie para `/etc/` se quiser os mesmos alertas/destino).
7. **DNS**: aponte o domínio (`A`) para o IP novo **só depois** de subir (passo 8) ou aceite alguns minutos fora do ar. O certificado novo sai sozinho (volume `pearchat_caddy_data` é restaurado no passo 9; se não restaurar, o Caddy pede outro; atenção ao limite semanal do Let's Encrypt).
8. **Suba tudo**: `cd /opt/pearchat && docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build`. (O app só sobe com o ambiente válido: o guarda de inicialização diz o que falta.)
9. **Dados**: pare o app e a Evolution, restaure e suba de novo:
   ```bash
   docker stop pearchat-app-1 pearchat-evolution-1
   bash /opt/pearchat/deploy/backup/restore.sh --overwrite --volumes --evolution AAAA-MM-DD_HHMM
   docker start pearchat-evolution-1 pearchat-app-1
   ```
   O `--overwrite` restaura o schema `pearchat` no Supabase (se o projeto Supabase sobreviveu, ele só é substituído; se o projeto também foi perdido, crie outro, ajuste a `DATABASE_URL` no `.env.production` **antes** e rode `npx prisma migrate deploy` num contêiner do app para criar as tabelas antes do restore).
10. **Confira**: `https://seu-dominio/api/health` (deve dar `{"ok":true}`), login, conversas, mídias e o WhatsApp (as sessões voltam com o volume da Evolution; se algum número pedir QR, reconecte pelo app).
11. **Reinstale backup e monitor**: `bash deploy/backup/install.sh --no-first-run` e `bash deploy/monitor/install.sh`; refaça o `rclone config` e o `/etc/pearchat-backup.conf`.
12. **Depois**: rode um backup novo (`bash deploy/backup/backup.sh`), troque as chaves que possam ter vazado se a VPS foi comprometida (não só perdida) — veja `docs/operacao/chaves.md` — e registre o que levou tempo.

## Quando algo dá errado na restauração

| Sintoma | O que fazer |
|---|---|
| `falha ao abrir o pacote (chave errada ou arquivo corrompido)` | A chave não é a que gerou o pacote. Compare a impressão digital (acima). Pacotes antigos podem ter sido feitos com outra chave: tente o anterior. |
| `HASH DIFERENTE` ou `tar corrompido` | O pacote foi alterado/cortado no download. Baixe de novo (`rclone check` compara com a nuvem). Use o pacote do dia anterior. |
| `pg_restore` com avisos sobre papéis/extensões | Esperado (`--no-owner`). O que importa é `RESTORE_OK` e a conferência. |
| O app sobe mas as mídias dão "não foi possível carregar" | O volume `pearchat_media` não foi restaurado (`--volumes`) ou o pacote é anterior à mídia. |
| WhatsApp pede QR de novo | O volume/banco da Evolution não foi restaurado, ou a sessão expirou do lado do celular. Reconecte pelo app. |
