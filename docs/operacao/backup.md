# Backup: cópia fora do servidor e teste de restauração

O servidor já faz um backup **todo dia às 3h30** (horário de São Paulo): banco do app (Supabase), banco e sessões do WhatsApp (Evolution), mídias das conversas, certificados e o `.env.production`, tudo **criptografado**. Detalhes técnicos: `deploy/backup/README.md`. O roteiro completo de restauração: **`deploy/backup/restore.md`**.

**O problema:** esse backup fica na **mesma máquina** do sistema, e a chave que abre os pacotes também. Se a VPS for perdida ou invadida, o backup vai junto. Para ficar seguro faltam **três coisas suas**, nesta ordem:

## 1. Guardar a chave do backup FORA do servidor (5 minutos)

No servidor: `cat /root/.pearchat-backup-key`. Copie para o seu **gerenciador de senhas** e imprima uma cópia em papel para guardar em local seguro. Feche o terminal. **Sem essa chave, nenhum pacote abre.**

Para conferir depois que a cópia está certa (sem mostrar a chave): `sha256sum /root/.pearchat-backup-key | cut -c1-12` no servidor deve ser igual a `printf '%s' 'A-CHAVE-QUE-VOCE-GUARDOU' | sha256sum | cut -c1-12` no seu computador.

Guarde também a `ENCRYPTION_KEY` do `.env.production` (`chaves.md`).

## 2. Ligar a cópia externa (15 minutos)

Escolha **um** destino. O PearChat usa o programa `rclone` (**ele não é instalado pelo deploy**; você instala uma vez):

```bash
curl https://rclone.org/install.sh | bash           # veja o script antes de rodar, se preferir
rclone config                                        # siga as perguntas (veja abaixo)
```

- **Backblaze B2 (recomendado: barato e simples):** crie uma conta em backblaze.com, um **bucket privado** e uma **Application Key restrita a esse bucket**. No `rclone config`: novo remote, nome `b2`, tipo `b2`, cole o ID e a chave.
- **Google Drive:** `rclone config` → tipo `drive`. Como o servidor não tem navegador, responda **n** em "Use auto config" e autorize no seu computador com `rclone authorize "drive"`, colando o resultado no servidor.
- **S3 ou compatível (AWS, Wasabi, Cloudflare R2...):** tipo `s3`, informe o provedor, a chave de acesso e o endereço (endpoint).

Teste: `rclone lsd b2:` (troque `b2` pelo nome que você deu). Depois, ligue a cópia:

```bash
printf '%s\n' 'BACKUP_REMOTE=rclone:b2:NOME-DO-BUCKET/pearchat' 'BACKUP_REMOTE_KEEP_DAYS=45' >> /etc/pearchat-backup.conf
bash /opt/pearchat/deploy/backup/backup.sh        # faz um backup real agora (uns minutos)
cat /opt/pearchat-backups/last-status.json         # deve mostrar "remoto": "ok"
```

O programa confere o arquivo na nuvem (tamanho e hash) depois de enviar; se não conferir, não conta como cópia e o monitor avisa. Guarde também a **credencial do rclone** (o token do B2/Drive) no gerenciador de senhas: ela **não** entra no backup.

## 3. Testar a restauração (10 minutos, não toca na produção)

```bash
cd /opt/pearchat
bash deploy/backup/restore.sh --verify                # escolha o pacote mais recente; deve terminar em VERIFY_OK
bash deploy/backup/restore.sh AAAA-MM-DD_HHMM         # restaura num schema NOVO e mostra quantas linhas há em cada tabela
```

Compare os números com o app. Depois apague o schema de teste no SQL Editor do Supabase: `DROP SCHEMA pearchat_restore_AAAAMMDD CASCADE;` (só esse). **Repita todo mês** e anote a data: backup que nunca foi restaurado é só uma esperança.

Se você usar o papel de banco restrito (`supabase.md`), o schema novo precisa do papel das migrações: rode com `RESTORE_DATABASE_URL` apontando para ele.

## Como saber se está tudo bem

- O monitor lembra a cada 6 horas enquanto o backup **não tiver cópia externa**.
- O endereço de verificação do UptimeRobot passa a dar erro com `backup_atrasado` se o último backup bom tiver mais de 2 dias (`monitoramento.md`). O arquivo de status só aparece depois do primeiro backup depois da publicação (ou rode `backup.sh` à mão uma vez).
