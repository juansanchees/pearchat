# Supabase: o que conferir no painel e como dar ao app só o poder que ele precisa

O PearChat usa o Supabase **só como banco Postgres**, pelo Prisma (conexão direta). Ele não usa a API REST, o login nem o armazenamento do Supabase. Então tudo o que o Supabase expõe além do banco é **superfície de ataque sem benefício**: vamos desligar ou conferir.

Todas as consultas SQL abaixo de "verificar" só **leem**. Rode no painel: **SQL Editor**.

## 0. A conta de demonstração do seed pode existir em produção (confira primeiro)

O comando de "seed" cria uma conta de demonstração (dona de uma empresa fictícia) com e-mail e senha que **já foram públicos** no repositório e continuam no histórico do git. Como o seu computador usou o mesmo banco da produção, essa conta pode existir lá. **Verificar** (só leitura):

```sql
select u.id, u.email, u."createdAt" from pearchat."User" u where lower(u.email) = 'mariana@doceatelie.com.br';
select count(*) as usuarios from pearchat."User";
select u.email, u."createdAt" from pearchat."User" u order by u."createdAt" desc limit 20;   -- cadastros estranhos?
```

Se a conta existir e **não** for sua: exporte o que precisar e remova a organização dela (entre como dona com "Esqueci minha senha" e apague pelo app, ou apague no SQL depois de exportar; os dados ligados caem em cascata). Se for sua conta de testes: **troque a senha, ligue a verificação em 2 etapas** e use um e-mail real. **Risco:** apagar dados de que você precisa; exporte antes.

**Separe os ambientes:** o `.env` do seu computador (e a pasta do OneDrive que o sincroniza) **não deve conter a URL nem as chaves de produção**. Use o projeto Supabase de desenvolvimento do item 3 e chaves próprias de desenvolvimento. O arquivo `deploy/.env.production` **não deve ficar no seu computador**: ele mora só no servidor (`publicacao.md`).

## 1. Desligar a API pública (Data API)

O Supabase cria sozinho uma API REST para as tabelas do schema `public` (acessível com a chave "anon", que costuma ser pública). Se o Zapfloo antigo deixou tabelas sem proteção, qualquer um com a URL do projeto e essa chave poderia lê-las.

1. **Project Settings → Data API** (ou "API"): desligue **Enable Data API**. O PearChat não usa.
2. Se preferir manter ligada, em **Exposed schemas** deixe só o necessário e **nunca** `pearchat`.
3. **Authentication → Providers**: se você não usa o login do Supabase, deixe sem provedores e sem cadastro público.

## 2. Conferir proteção por linha (RLS) e quem enxerga o quê

**Verificar** (SQL Editor):

```sql
-- schemas que existem (procure sobras: pearchat_test_a..e, restauracoes, o schema do Zapfloo)
select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1;

-- as tabelas do schema "public" têm RLS ligado?
select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' order by 2;

-- o que os papéis "anon" e "authenticated" (da API pública) conseguem em cada schema
select table_schema, grantee, count(*) from information_schema.role_table_grants
 where grantee in ('anon','authenticated') group by 1,2 order by 1;

-- papéis de banco existentes
select r.rolname, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname !~ '^(pg_|supabase|pgbouncer)' order by 1;
```

**Como ler:** `rowsecurity = false` nas tabelas de `public` **e** `anon` com privilégios em `public` = dados legíveis por quem tiver a chave pública. **Corrigir** (uma tabela por vez): `alter table public."<tabela>" enable row level security;` (sem políticas, `anon` deixa de ler). Se o Zapfloo está encerrado, **exporte e apague** as tabelas dele em vez de proteger. **Risco:** se algo antigo ainda usa essas tabelas pela API, para de funcionar (é o esperado).

## 3. Limpar o que sobrou de teste

Os schemas `pearchat_test_*` e os de restauração (`pearchat_restore_*`) ficam no **mesmo banco** da produção. Teste com URL errada ou um `DROP` por engano atinge dados reais. **Corrigir:** crie um **segundo projeto Supabase só para desenvolvimento e testes** (o plano gratuito permite 2), aponte o `.env` do seu computador para ele, e depois **exporte e apague** os schemas de teste do projeto de produção. **Apagar é irreversível: exporte antes.**

## 4. Senha do banco e acesso por rede

1. **Senha:** em **Project Settings → Database → Reset database password**, troque a senha do usuário `postgres` por uma longa e aleatória (`openssl rand -base64 24`). Depois atualize a `DATABASE_URL` no `.env.production` **do servidor** (e `RESTORE_DATABASE_URL` se usar) e recrie o app (`docker compose ... up -d app`). **Risco:** o app fica sem banco até você atualizar; faça em horário calmo e com a URL nova pronta.
2. **Restrição de rede:** em **Database → Network Restrictions**, permita só o IP da VPS (se o seu plano permitir; **a conferir**: pode exigir plano pago). Seu computador também deixa de conectar: use o projeto de desenvolvimento.
3. **Backups:** em **Database → Backups**, veja se existem (no plano gratuito não há). O backup do PearChat (`deploy/backup`) cobre isso: confirme que a cópia externa está ligada.

## 5. Papel de banco com privilégios mínimos (recomendado)

Hoje o app conecta como `postgres` (administrador de tudo). Se uma falha vazar a `DATABASE_URL`, o atacante tem o projeto inteiro. O ideal são **dois papéis**: um que **só roda as migrações** e é dono do schema `pearchat`, e outro **só para o app**, que mexe nos dados mas não altera a estrutura nem enxerga outros schemas.

**Faça primeiro num projeto/schema de teste, e guarde a URL antiga para voltar.** No SQL Editor do projeto de produção, **troque as duas senhas** pelos valores gerados (`openssl rand -base64 24`):

```sql
create role pearchat_migrator login password 'TROQUE-POR-SENHA-FORTE-1';
create role pearchat_app      login password 'TROQUE-POR-SENHA-FORTE-2';

-- permite ao "postgres" repassar a propriedade (necessário no Supabase)
grant pearchat_migrator to postgres;

-- o schema e tudo dentro dele passam a ser do papel das migrações
alter schema pearchat owner to pearchat_migrator;
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'pearchat' loop
    execute format('alter table pearchat.%I owner to pearchat_migrator', r.tablename);
  end loop;
  for r in select sequencename from pg_sequences where schemaname = 'pearchat' loop
    execute format('alter sequence pearchat.%I owner to pearchat_migrator', r.sequencename);
  end loop;
  for r in select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'pearchat' and t.typtype = 'e' loop
    execute format('alter type pearchat.%I owner to pearchat_migrator', r.typname);
  end loop;
end $$;

-- o papel do app: só mexe nos DADOS deste schema
grant usage on schema pearchat to pearchat_app;
grant select, insert, update, delete on all tables in schema pearchat to pearchat_app;
grant usage, select on all sequences in schema pearchat to pearchat_app;
-- tabelas criadas por migrações futuras já nascem com esses acessos
alter default privileges for role pearchat_migrator in schema pearchat grant select, insert, update, delete on tables to pearchat_app;
alter default privileges for role pearchat_migrator in schema pearchat grant usage, select on sequences to pearchat_app;

alter role pearchat_app      set search_path = pearchat;
alter role pearchat_migrator set search_path = pearchat;
```

Depois, no `/opt/pearchat/deploy/.env.production` **do servidor**:

- `DATABASE_URL` passa a usar o papel do app. No pooler do Supabase o usuário é `papel.<id-do-projeto>`, por exemplo `pearchat_app.<id-do-projeto>`. Mantenha o resto da URL (host, porta, `?schema=pearchat`).
- Acrescente `MIGRATE_DATABASE_URL` com o mesmo formato e o papel `pearchat_migrator.<id-do-projeto>`. **O deploy usa essa variável só para rodar as migrações** (o app nunca a usa).
- Se for restaurar um backup num schema novo (`deploy/backup/restore.md`), use `RESTORE_DATABASE_URL` com o papel das migrações (o papel do app não pode criar schemas).

Depois: faça um deploy (`bash deploy/deploy.sh`) e confira o login. **Se der `permission denied`:** volte a `DATABASE_URL` antiga no arquivo, recrie o app (`docker compose -p pearchat -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d app`) e me mostre o erro. Só depois que tudo funcionar, troque a senha do `postgres` (item 4.1).
