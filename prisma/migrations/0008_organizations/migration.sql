-- Etapa 0: vários WhatsApps por conta. Cada WhatsApp continua sendo um Workspace; a Organization agrupa
-- os espaços e passa a ser a dona do plano/assinatura. 100% ADITIVA: só tabela nova e colunas NULÁVEIS
-- (ou com DEFAULT), então o app antigo continua funcionando enquanto a migração aplica.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "plano" "Plan" NOT NULL DEFAULT 'PRO',
    "statusAssinatura" TEXT NOT NULL DEFAULT 'ativa',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "organizationId" TEXT,
ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "arquivadoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (idempotente: só toca em Workspace/User ainda sem organização; pode rodar de novo sem efeito).
-- Uma organização por workspace existente, com o mesmo id derivado ('org_' || id do workspace).
INSERT INTO "Organization" ("id", "nome", "plano", "statusAssinatura", "createdAt", "updatedAt")
SELECT 'org_' || w."id", w."nome", w."plano", w."statusAssinatura", w."createdAt", CURRENT_TIMESTAMP
FROM "Workspace" w
WHERE w."organizationId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "Workspace" SET "organizationId" = 'org_' || "id" WHERE "organizationId" IS NULL;

UPDATE "User" u SET "organizationId" = w."organizationId"
FROM "Workspace" w
WHERE u."workspaceId" = w."id" AND u."organizationId" IS NULL AND w."organizationId" IS NOT NULL;
