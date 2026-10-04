-- Respostas rápidas (composer "/atalho"). 100% ADITIVA: uma tabela nova.

-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "atalho" TEXT NOT NULL,
    "titulo" TEXT,
    "texto" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_workspaceId_atalho_key" ON "QuickReply"("workspaceId", "atalho");

-- CreateIndex
CREATE INDEX "QuickReply_workspaceId_ordem_idx" ON "QuickReply"("workspaceId", "ordem");

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
