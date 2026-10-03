# PearChat

Pequenos negócios conectam o WhatsApp, atendem clientes e ligam automações (IA, disparos, follow-up, agenda).

Stack: Next.js 14 (App Router), TypeScript, Tailwind v3, shadcn/ui, Phosphor, Prisma + Postgres, Auth.js v5, Socket.io, BullMQ + Redis, zod.

## Como rodar

```bash
cp .env.example .env        # preencha AUTH_SECRET e ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up -d        # postgres, redis e evolution-api
npm i
npx prisma migrate deploy   # ou: npm run db:migrate
npx prisma db seed          # ou: npm run db:seed
npm run dev
```

Login de desenvolvimento (seed): `mariana@doceatelie.com.br` / `pearchat123`.

O app roda num **servidor Node custom** (`server.ts`): Next.js + Socket.io (path `/api/socket`) no mesmo processo.
`npm run dev` executa `tsx watch server.ts`; em produção use `npm run build` e depois `npm start` (`tsx server.ts --prod`).
Não use `next dev` / `next start` diretamente (o tempo real não sobe) e não há suporte a deploy serverless (ex.: Vercel):
é preciso um processo Node de longa duração (VPS, container, Railway, Fly etc.).

Para testar conversas sem WhatsApp real, defina `WA_MOCK=true` e `NEXT_PUBLIC_WA_MOCK=true` no `.env`; a lista vazia ganha o botão
"Simular mensagem de cliente" (`POST /api/dev/inbound`).

Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `db:studio`.

## Variáveis de ambiente

Veja `.env.example` (cada variável tem um comentário). As principais: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `AUTH_URL`,
`META_*` (API Oficial / Embedded Signup), `EVOLUTION_*` (conexão rápida), `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`, `ENCRYPTION_KEY`.

## Estrutura

```
prisma/                 schema, migrations e seed
docker/postgres/        init.sql (cria o banco "evolution")
src/auth.ts             Auth.js (Credentials + adapter Prisma, sessão JWT)
src/auth.config.ts      parte da config compatível com Edge (usada pelo middleware)
src/middleware.ts       protege as rotas (exceto /login, /registro, /api/auth, /api/wa/*)
src/app/(auth)/         login e registro
src/app/(app)/          app autenticado (shell com sidebar + páginas)
src/components/ui/      shadcn/ui
src/components/{sidebar,whatsapp,conversas,drawers}/   telas (a construir)
src/lib/                db, session, types (contratos), tokens, mappers
src/server/whatsapp/    interface WhatsAppProvider + esqueletos (cloud-api, evolution)
src/server/realtime/    tipos dos eventos Socket.io
src/server/queues/      filas BullMQ (a construir)
```

Tokens de design: `src/lib/tokens.ts` -> `tailwind.config.ts` (`dark-*`, `light-*`, `google`, `manual`, `amber-*`) e CSS variables em `src/app/globals.css`.

## O que ainda falta

- Sidebar real (`// TODO(sidebar-agent)` em `src/app/(app)/layout.tsx`) e as telas de WhatsApp, Conversas, Agenda e Contatos.
- Implementar `CloudApiProvider` e `EvolutionProvider` e ligar em `getProvider`.
- Rotas de webhook `/api/wa/meta` e `/api/wa/evolution`.
- Servidor Socket.io e filas BullMQ (disparos, follow-up, lembretes).
- Agente de IA, Google Agenda (OAuth), planos e pagamento.
- Criptografia de `sessionData` e `tokens` com `ENCRYPTION_KEY`.
- Shadcn usa ícones `lucide-react` internamente; as telas do produto usam Phosphor.
