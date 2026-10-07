# Chaves e senhas: como trocar cada uma e onde

**Regra de ouro:** troque a chave **no servidor e no painel do serviço ao mesmo tempo**, e recrie o app logo depois. Se trocar só um dos lados, aquela parte do PearChat para de funcionar até você terminar.

Onde ficam as chaves do PearChat: no arquivo `/opt/pearchat/deploy/.env.production` **do servidor** (permissão 600). Para recriar o app depois de editar:

```bash
cd /opt/pearchat && docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d app
```

Antes de editar, faça uma cópia: `cp -p deploy/.env.production /root/env.production.$(date +%F).bak && chmod 600 /root/env.production.*.bak` (apague a cópia depois: ela tem segredos).

O app **se recusa a subir** se `AUTH_SECRET`, `ENCRYPTION_KEY` ou `EVOLUTION_API_KEY` estiverem fracos ou de exemplo, então um valor ruim colocado por engano aparece logo no log (`docker logs pearchat-app-1`).

## Tabela rápida

| Chave | Gerar | O que acontece ao trocar | Risco |
|---|---|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` | **Todo mundo é deslogado**; convites e links de redefinição pendentes deixam de valer | baixo |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` | **NÃO TROQUE sem um script de recriptografia.** Tokens do Google/Meta, segredos de 2 etapas e CPFs gravados ficam ilegíveis | **ALTO: perda de dados** |
| `EVOLUTION_API_KEY` | `openssl rand -base64 32` (sem `=+/`) | A Evolution e o app precisam ter a **mesma** chave. Trocar exige recriar os dois (`up -d evolution app`) e as instâncias já conectadas continuam, mas o webhook antigo some até o app reconfigurar | médio |
| `EVOLUTION_DB_PASSWORD` | `openssl rand -base64 24` | Muda a senha do Postgres da Evolution: **não troque só no arquivo** (o banco já foi criado com a senha antiga). Só com `ALTER USER` dentro do contêiner. Deixe como está, a menos que haja suspeita | médio |
| `HEALTH_TOKEN` | `openssl rand -base64 32 \| tr -d '=+/'` | O endereço do monitor externo muda (`monitoramento.md`) | baixo |
| `DATABASE_URL` | senha nova no Supabase (`supabase.md`) | Sem banco até atualizar a URL e recriar o app | médio |

**A `ENCRYPTION_KEY` precisa ser guardada FORA do servidor** (gerenciador de senhas e uma cópia impressa em local seguro). Ela está no `.env.production` e dentro do backup, mas o backup só abre com a chave **dele** (também guardada fora, ver `deploy/backup/restore.md`). Sem essa chave guardada, perder o servidor significa perder esses dados.

## OpenAI (a IA que responde os clientes)

1. **platform.openai.com → Projects:** crie um projeto **`pearchat-prod`** (produção) e outro **`pearchat-dev`** (seu computador). Chaves **diferentes**.
2. Em cada projeto, **Limits** (ou Settings → Limits): defina um **orçamento mensal** (Budget) e **alerta por e-mail** (por exemplo, avisar em 50% e 80%). Sem teto, um abuso vira conta alta.
3. Na chave, use **permissões restritas** (Restricted): só o que o PearChat usa (respostas/chat e transcrição de áudio).
4. Para trocar: crie a chave nova → `OPENAI_API_KEY` no servidor → recrie o app → confirme que a IA responde → **revogue a chave antiga** no painel.

Se o monitor avisar `ia_sem_credito`: falta crédito, o limite estourou, ou a chave foi revogada.

## Meta (WhatsApp oficial)

- O app da Meta deve estar em modo **Ativo** só com as permissões usadas.
- **Configurações avançadas:** ligue "Exigir prova do segredo do app" quando possível e, se o painel permitir, a lista de IPs do servidor.
- Se o `META_APP_SECRET` ou o `META_VERIFY_TOKEN` já passaram pelo seu computador/OneDrive e você considera isso exposição: **redefina o segredo do app** no painel, atualize `META_APP_SECRET` no servidor e o token de verificação no painel de webhooks **na mesma hora**.
- `META_SYSTEM_USER_TOKEN` (se usado): só com as permissões de WhatsApp necessárias.

## Google (login e Agenda)

- Crie **dois clientes OAuth**: um para produção (só `https://seu-dominio/api/auth/callback/google` e o retorno da Agenda) e outro para o seu computador (localhost).
- Escopos mínimos: `openid email profile` e Agenda só se usada. Publique a tela de consentimento.
- Para trocar o segredo: gere um novo no Google Cloud → `GOOGLE_CLIENT_SECRET` no servidor → recrie o app.

## Resend (e-mails do PearChat)

Chave com permissão **só de envio**, restrita ao seu domínio (`email-dominio.md`). Trocar: chave nova → `RESEND_API_KEY` no servidor → recrie o app → revogue a antiga.

## Asaas (cobrança, quando ligar)

Mantenha o ambiente de teste (sandbox) até ativar a cobrança de verdade. Ao ativar: chave com **lista de IPs permitidos** (o IP do servidor) e o webhook com o `ASAAS_WEBHOOK_TOKEN`. O app **recusa subir** com `BILLING_ENABLED=true` e o Asaas de teste.

## Se uma chave vazou

Troque **primeiro** as de maior estrago (`DATABASE_URL`, `OPENAI_API_KEY`, `META_APP_SECRET`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`), depois `AUTH_SECRET` e `EVOLUTION_API_KEY`. Deixe a `ENCRYPTION_KEY` por último e **só com o script de recriptografia**. Confira no GitHub se a chave não foi enviada num commit (`repositorio.md`: varredura de segredos).
