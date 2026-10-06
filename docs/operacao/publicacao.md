# Publicação: colocar uma versão nova no ar, voltar atrás e o que olhar depois

Referência técnica dos scripts: `deploy/README.md`. Aqui está o essencial, na ordem em que você usa.

## Antes de tudo (uma vez só)

1. Crie o arquivo `deploy/.deploy.env` no seu computador (copie de `deploy/deploy.env.example`) e preencha o endereço do servidor, o usuário e o caminho da chave SSH. **Esse arquivo não vai para o GitHub** (está no `.gitignore`).
2. Para a conta de teste do `validate.mjs`, crie `deploy/.validate.env` com `VALIDATE_EMAIL=` e `VALIDATE_PASSWORD=` de uma conta **só de teste** (nunca de cliente). Também fica fora do GitHub. Sem esse arquivo o `validate.mjs` faz só as verificações anônimas.
3. Lembre: o servidor só aceita cerca de **1 conexão SSH por hora**. Todos os scripts usam uma conexão só e depois acompanham pelo navegador (curl). Não rode dois scripts de SSH em seguida.

## O arquivo de ambiente (`.env.production`) mora SÓ no servidor

Ele fica em `/opt/pearchat/deploy/.env.production`. O deploy **nunca o envia nem o sobrescreve**. Quem edita é você, no servidor. A cada deploy o servidor só **acrescenta** chaves que faltam (por exemplo `HEALTH_TOKEN`), sempre guardando antes uma cópia com data (`.env.production.bak-AAAAMMDD-HHMMSS`, só você lê).

Antes de trocar o app, o servidor confere esse arquivo com as mesmas regras que o app usa para subir. Se algo estiver perigoso ou faltando, **o deploy para e o app antigo continua no ar**, e o motivo aparece no log (`bash deploy/status.sh`). O app **se recusa a subir** em produção se:

- `WA_MOCK`, `NEXT_PUBLIC_WA_MOCK`, `BILLING_MOCK`, `MAIL_DRY_RUN` ou `ENGINE_FOLLOWUP_ANYTIME` estiverem ligados (são só para testes);
- `CONTACT_PHOTO_TEST_HOSTS`, `WA_MOCK_PHOTO_BASE` ou `META_GRAPH_BASE_URL` (fora da Meta) estiverem definidos;
- `BILLING_ENABLED=true` com o Asaas de teste (sandbox) ou sem chave/token do Asaas;
- `AUTH_SECRET`, `ENCRYPTION_KEY` ou `EVOLUTION_API_KEY` estiverem faltando, curtos, ou parecerem exemplo (`ENCRYPTION_KEY` precisa ser base64 de 32 bytes);
- `EVOLUTION_WEBHOOK_URL` não for o endereço interno (`http://app:3000/api/wa/evolution`): a borda bloqueia esse caminho pela internet;
- `DATABASE_URL` apontar para um schema de teste (`pearchat_test_*`, `pearchat_restore_*`...) ou não tiver `?schema=pearchat`;
- `AUTH_URL` não for `https://` do domínio real.

`ENGINE_DISABLED=true` não impede de subir, mas escreve um aviso bem grande no log (o motor de automações fica desligado).

### Primeira instalação (servidor novo)

1. No servidor, crie `/opt/pearchat/deploy/` e o arquivo `.env.production` (permissão 600). Dá para gerar a partir do `.env` do seu computador com `node deploy/gen-env.mjs` e copiar o resultado com `scp`; depois **apague a cópia local** (`.env.production` não deve ficar no seu computador nem no OneDrive).
2. Confira com a lista acima. As chaves `AUTH_SECRET`, `EVOLUTION_API_KEY`, `HEALTH_TOKEN` são geradas aleatórias; **a `ENCRYPTION_KEY` você guarda também fora do servidor** (gerenciador de senhas): sem ela os dados criptografados não abrem.
3. Para o domínio novo: `bash deploy/deploy-domain.sh`. Depois: `bash deploy/deploy.sh`.

## Publicar uma versão nova

1. Faça `commit` de tudo (o script **recusa** publicar com alterações não salvas; `DEPLOY_ALLOW_DIRTY=1` força, e só deve ser usado de propósito).
2. `bash deploy/deploy.sh` (uma conexão SSH). Ele envia o código, dispara o build no servidor e passa a acompanhar `https://seu-dominio/login`. Termina em `SITE_UP`.
3. Confirme o resultado: `bash deploy/status.sh` (outra conexão SSH: espere uns 60 minutos depois do deploy). O fim do log deve dizer `DEPLOY_RESULT=ok`.

**O que o servidor faz sozinho (nessa ordem):** guarda uma cópia do `.env.production`; marca a versão em uso como `previous`; compila a versão nova (o site antigo continua no ar); confere o ambiente; roda as migrações do banco; troca o app; e **verifica**: saúde do app e do banco, login (página, token e sessão), o Caddy (e que as rotas de teste estão bloqueadas), o WhatsApp (Evolution de pé e a rede interna entre ela e o app). **Se qualquer verificação falhar, ele volta sozinho para a versão anterior** e escreve `DEPLOY_RESULT=fail_rolled_back` no log.

> **Aviso do primeiro deploy com estes arquivos:** o compose mudou (limites, logs, redes). O servidor vai **recriar** o Caddy, a Evolution, o Postgres e o Redis da Evolution. O WhatsApp conectado desconecta e **volta sozinho em cerca de 1 minuto** (as sessões ficam nos volumes). Faça em horário de pouco movimento e, se algum número pedir o QR de novo, reconecte pelo app.

### O que olhar depois de publicar (5 minutos)

- `https://seu-dominio/login` abre; entre com uma conta sua.
- Abra o endereço de verificação do monitor (`monitoramento.md`): deve mostrar `OK`.
- No app, o cartão do WhatsApp deve estar **conectado**; mande uma mensagem de teste.
- `node deploy/validate.mjs` (do seu computador): deve terminar em `VALIDATE_OK`.
- Dois ou três dias depois: o monitor externo continua verde e não chegou aviso de backup.

## Voltar para a versão anterior

- **Automático:** se a verificação do deploy falhar, já volta sozinho (veja acima).
- **Manual** (o problema apareceu depois): `bash deploy/rollback.sh` (uma conexão SSH). Ele restaura a imagem `previous` e a configuração anterior do compose e do Caddy, e confere que funcionou. O resultado fica em `deploy/last-deploy.log` (`ROLLBACK_RESULT=ok`), visível com `bash deploy/status.sh`.
- Só dá para voltar **uma** versão (a anterior). Se o problema for dado ruim no banco, use `deploy/backup/restore.md`.

### A regra que torna a volta segura: migrações só ADICIONAM

Voltar o app não desfaz o que o banco já ganhou. Por isso toda migração nova **só pode adicionar** coisas: tabela nova, coluna nova que aceite vazio (ou com valor padrão), índice. **Nunca** na mesma versão: apagar tabela ou coluna, renomear, ou tornar uma coluna obrigatória. Isso só pode acontecer numa versão **seguinte**, depois que o código antigo já não usa mais o item. Antes de qualquer migração que apague algo, rode um backup à mão (`bash /opt/pearchat/deploy/backup/backup.sh`).

## Next.js 14: o que está mitigado e o que só o Next 15 resolve

O PearChat usa o Next.js 14.2.35, a **última** versão da linha 14 (não há 14.2.x mais nova). As correções vivem no Next 15.5.24 ou superior: a migração é uma etapa à parte. Enquanto isso, estas medidas estão no repositório: otimizador de imagens desligado (`images.unoptimized`) e `/_next/image` bloqueado no Caddy; Server Actions só aceitam a origem do site e corpo de até 256 KB; o Caddy limita o tamanho de cada requisição, só deixa WebSocket em `/api/socket` e só responde ao domínio do site (sem `Host` falso); e `/api/dev`, `/api/wa/mock` e `/api/wa/evolution` não ficam acessíveis pela internet.

| Aviso do `npm audit` | Situação |
|---|---|
| Otimizador de imagens: DoS por `remotePatterns`, crescimento do cache, DoS na API (3 avisos) | **Mitigado**: otimizador desligado e rota bloqueada na borda |
| RCE no otimizador com AVIF | **Mitigado**: otimizador desligado, sem AVIF no projeto |
| RCE em servidores Windows | **Não se aplica**: o servidor é Linux (Docker) |
| SSRF em Server Actions com servidor próprio (o app tem `server.ts`) | **Mitigado em parte**: a borda só aceita o domínio do site, `allowedOrigins` restrito. Só o Next 15 resolve de vez |
| SSRF por upgrade de WebSocket | **Mitigado na borda**: Upgrade só em `/api/socket` (o app só escuta em loopback) |
| SSRF/smuggling em `rewrites` (2 avisos) | **Não se aplica**: o app não usa `rewrites` |
| DoS com Server Components / Server Actions (5 avisos, incluindo corpo sem limite) | **Reduzido** por limite de corpo (Caddy 1 MB, Server Actions 256 KB) e tempos-limite. Só o Next 15 resolve |
| Cache envenenado/confuso (RSC, redirecionamento do middleware, corpos) (5 avisos) | **Não se aplica hoje**: não há cache compartilhado nem CDN na frente. **Reavaliar se colocar Cloudflare/CDN** |
| XSS com `nonce` de CSP e com scripts `beforeInteractive` (2 avisos) | **Não se aplica**: o app não usa CSP com nonce nem `beforeInteractive` |
| Bypass de middleware com `i18n` no Pages Router | **Não se aplica**: App Router, sem i18n do Next |
| Divulgação de endpoints internos de Server Functions | **Só o Next 15**: revela nomes de endpoints; todas as ações exigem autenticação e validam no servidor |
| `postcss` (4 avisos, dentro do Next) | **Não se aplica em produção**: só processa o CSS do próprio projeto, no build. Sai com a atualização do Next |
| `prisma`/`@prisma/config`/`deepmerge-ts` (3) | **Não se aplica em produção**: ferramenta de linha de comando (migrações), sem entrada de terceiros. Só uma atualização maior do Prisma |
| `tailwindcss`, `braces`, `micromatch`, `fast-glob`, `chokidar` (5) | **Não se aplica em produção**: só no build. Só com o Tailwind 4 (atualização maior) |

Quando o Next 15 for aplicado, rode `npm audit --omit=dev` de novo e atualize esta tabela.
