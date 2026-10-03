-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "duracaoMin" INTEGER NOT NULL,
    "cor" TEXT,
    "ordem" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "serviceTypeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_workspaceId_nome_key" ON "ServiceType"("workspaceId", "nome");

-- CreateIndex
CREATE INDEX "ServiceType_workspaceId_ativo_ordem_idx" ON "ServiceType"("workspaceId", "ativo", "ordem");

-- AddForeignKey
ALTER TABLE "ServiceType" ADD CONSTRAINT "ServiceType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
