# PearChat

Pequenos negócios conectam o WhatsApp, atendem clientes e ligam automações (IA, disparos, follow-up, agenda).

Stack: Next.js 14 (App Router), TypeScript, Tailwind v3, shadcn/ui, Phosphor, Prisma + Postgres, Auth.js v5, Socket.io, BullMQ + Redis, zod.

## Como rodar (desenvolvimento)

```bash
cp .env.example .env        # preencha AUTH_SECRET e ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up -d        # postgres, redis e evolution-api (só em localhost; use apenas no seu computador)
npm i
npx prisma migrate deploy   # ou: npm run db:migrate
npx prisma db seed          # ou: npm run db:seed (cria uma conta de demonstração: veja o terminal)
npm run dev
```

**Use sempre um banco de desenvolvimento só seu, nunca o de produção**: o motor de automações roda junto com o servidor
e o seed/os testes escrevem no banco apontado pela `DATABASE_URL`.

Conta de demonstração (opcional, só em desenvolvimento): defina `SEED_DEMO_PASSWORD` (12+ caracteres, no seu `.env` local, nunca no repositório) antes de `npx prisma db seed`; sem a variável, o seed não cria a conta. O seed recusa rodar com `NODE_ENV=production` ou contra um banco que não seja local (a menos que `SEED_ALLOW_PRODUCTION=1` / `SEED_ALLOW_REMOTE=1`, de propósito). Para trocar a senha de uma conta existente: `scripts/rotate-demo-password.ts`.

O app roda num **servidor Node custom** (`server.ts`): Next.js + Socket.io (path `/api/socket`) no mesmo processo.
`npm run dev` executa `tsx watch server.ts`; em produção use `npm run build` e depois `npm start` (`tsx server.ts --prod`).
Não use `next dev` / `next start` diretamente (o tempo real não sobe) e não há suporte a deploy serverless (ex.: Vercel):
é preciso um processo Node de longa duração (VPS, container, Railway, Fly etc.).

Para testar conversas sem WhatsApp real, defina `WA_MOCK=true` e `NEXT_PUBLIC_WA_MOCK=true` no `.env` **de desenvolvimento**; a lista vazia ganha
o botão "Simular mensagem de cliente". Em produção essas variáveis (e `MAIL_DRY_RUN`, `BILLING_MOCK`, etc.) são recusadas: o servidor
não sobe (guarda de inicialização em `src/server/boot/guard.ts`).

Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `db:studio`.
Testes: `npx tsx --test tests/boot-guard.test.ts tests/health-check.test.ts` (não precisam de banco); os demais usam um schema de teste do Postgres.

## Variáveis de ambiente

Veja `.env.example` (cada variável tem um comentário). As principais: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `AUTH_URL`,
`META_*` (API Oficial / Embedded Signup), `EVOLUTION_*` (conexão rápida), `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`.

## Publicação e operação

Tudo o que é de servidor, publicação, backup e monitoramento está em `deploy/` (referência técnica: `deploy/README.md`) e,
em português simples e passo a passo para quem opera, em **`docs/operacao/`** (comece por `docs/operacao/README.md`).
Nenhum endereço de servidor, usuário, chave ou senha fica neste repositório.

## Estrutura

```
prisma/                 schema, migrations e seed
docker/postgres/        init.sql (cria o banco "evolution", só desenvolvimento)
deploy/                 publicação, Caddy, compose de produção, backup e monitor
docs/operacao/          guias do dono (servidor, Supabase, chaves, e-mail, repositório, publicação, monitoramento)
src/auth.ts             Auth.js (Credentials + adapter Prisma, sessão JWT)
src/auth.config.ts      parte da config compatível com Edge (usada pelo middleware)
src/middleware.ts       protege as rotas (exceto login, cadastro, /api/auth, /api/wa/*, /api/health, páginas públicas)
src/app/(auth)/         login e registro
src/app/(app)/          app autenticado (shell com sidebar + páginas)
src/components/         ui (shadcn) e telas
src/lib/                db, session, types (contratos), tokens, mappers
src/server/             domínio: whatsapp, messages, engine (automações), security, boot (guarda de inicialização)...
```

Tokens de design: `src/lib/tokens.ts` -> `tailwind.config.ts` (`dark-*`, `light-*`, `google`, `manual`, `amber-*`) e CSS variables em `src/app/globals.css`.
Shadcn usa ícones `lucide-react` internamente; as telas do produto usam Phosphor.
