-- Etapa 4: link público de agendamento. 100% ADITIVA: colunas nulas ou com DEFAULT e uma tabela nova.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "slug" TEXT,
ADD COLUMN "bookingAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "bookingAntecedenciaMin" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN "bookingDiasAFrente" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "bookingMensagem" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "canal" TEXT;

-- CreateTable
CREATE TABLE "BookingAttempt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "telefoneHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "BookingAttempt_workspaceId_ipHash_createdAt_idx" ON "BookingAttempt"("workspaceId", "ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "BookingAttempt_workspaceId_telefoneHash_createdAt_idx" ON "BookingAttempt"("workspaceId", "telefoneHash", "createdAt");

-- CreateIndex
CREATE INDEX "BookingAttempt_createdAt_idx" ON "BookingAttempt"("createdAt");

-- AddForeignKey
ALTER TABLE "BookingAttempt" ADD CONSTRAINT "BookingAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
