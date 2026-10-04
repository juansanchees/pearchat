-- Etapa 2: IA agendando e confirmação de presença. 100% ADITIVA: só colunas nulas ou com DEFAULT e um índice.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ativo',
ADD COLUMN "canceladoEm" TIMESTAMP(3),
ADD COLUMN "canceladoPor" TEXT,
ADD COLUMN "confirmacao" TEXT NOT NULL DEFAULT 'pendente',
ADD COLUMN "confirmadoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EventReminder" ADD COLUMN "pediuConfirmacao" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "ofertasIa" JSONB;

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN "ferramentas" JSONB;

-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN "pedirConfirmacao" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Event_contactId_inicio_idx" ON "Event"("contactId", "inicio");
