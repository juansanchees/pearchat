-- AlterTable
ALTER TABLE "WhatsAppSession" ADD COLUMN "connectedAt" TIMESTAMP(3),
ADD COLUMN "historyStatus" TEXT NOT NULL DEFAULT 'nao_iniciada',
ADD COLUMN "historyStartedAt" TIMESTAMP(3),
ADD COLUMN "historyImportedAt" TIMESTAMP(3),
ADD COLUMN "historyStats" JSONB,
ADD COLUMN "historyPasses" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "imported" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (providerMessageId nulo não conflita: linhas antigas sem id continuam válidas)
CREATE UNIQUE INDEX "Message_conversationId_providerMessageId_key" ON "Message"("conversationId", "providerMessageId");
