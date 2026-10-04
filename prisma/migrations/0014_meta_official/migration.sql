-- Meta oficial (Cloud API): modelos de mensagem reais, cadastro incorporado e dados do número. 100% ADITIVA.

-- AlterEnum: novos estados de modelo vindos da Meta
ALTER TYPE "TemplateStatus" ADD VALUE IF NOT EXISTS 'PAUSADO';
ALTER TYPE "TemplateStatus" ADD VALUE IF NOT EXISTS 'DESATIVADO';

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "metaId" TEXT,
ADD COLUMN "language" TEXT NOT NULL DEFAULT 'pt_BR',
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "components" JSONB,
ADD COLUMN "syncedAt" TIMESTAMP(3),
ADD COLUMN "exampleValues" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WhatsAppSession" ADD COLUMN "metaBusinessId" TEXT,
ADD COLUMN "metaVerifiedName" TEXT,
ADD COLUMN "metaQuality" TEXT,
ADD COLUMN "metaCoexistence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "metaLastError" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "providerMediaId" TEXT,
ADD COLUMN "failReason" TEXT;

-- CreateTable
CREATE TABLE "MetaSignupState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaSignupState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaPartnerEvent" (
    "id" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "businessId" TEXT,
    "event" TEXT NOT NULL,
    "claimedByWorkspace" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaPartnerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppSession_metaWabaId_idx" ON "WhatsAppSession"("metaWabaId");

-- CreateIndex
CREATE INDEX "MetaSignupState_expiraEm_idx" ON "MetaSignupState"("expiraEm");

-- CreateIndex
CREATE INDEX "MetaSignupState_workspaceId_idx" ON "MetaSignupState"("workspaceId");

-- CreateIndex
CREATE INDEX "MetaPartnerEvent_wabaId_idx" ON "MetaPartnerEvent"("wabaId");

-- CreateIndex
CREATE INDEX "MetaPartnerEvent_createdAt_idx" ON "MetaPartnerEvent"("createdAt");
