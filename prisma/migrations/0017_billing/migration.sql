-- Pagamentos (Asaas) e limites de plano. 100% ADITIVA: colunas nulas/com DEFAULT e tabelas novas.
-- Organizações já existentes ficam 'isenta' (nada muda para quem já usa). Contas novas nascem 'trial' pelo código
-- (só quando BILLING_ENABLED=true). Nenhum dado de cartão é guardado: só ids do Asaas, status e datas.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'isenta',
ADD COLUMN "trialAte" TIMESTAMP(3),
ADD COLUMN "planoPendente" "Plan",
ADD COLUMN "planoAgendado" "Plan",
ADD COLUMN "asaasCustomerId" TEXT,
ADD COLUMN "asaasSubscriptionId" TEXT,
ADD COLUMN "proximaCobranca" TIMESTAMP(3),
ADD COLUMN "canceladaEm" TIMESTAMP(3),
ADD COLUMN "atrasadaDesde" TIMESTAMP(3),
ADD COLUMN "cpfCnpj" TEXT,
ADD COLUMN "avisoTrialEm" TIMESTAMP(3);

-- Backfill explícito e idempotente (o DEFAULT já cobre as linhas existentes): todas as organizações atuais são isentas.
UPDATE "Organization" SET "billingStatus" = 'isenta' WHERE "asaasSubscriptionId" IS NULL AND "trialAte" IS NULL;

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "asaasEventId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "organizationId" TEXT,
    "resumo" JSONB,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "asaasId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "vencimento" TIMESTAMP(3),
    "pagoEm" TIMESTAMP(3),
    "invoiceUrl" TEXT,
    "assinaturaId" TEXT,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_asaasCustomerId_key" ON "Organization"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_asaasSubscriptionId_key" ON "Organization"("asaasSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_asaasEventId_key" ON "BillingEvent"("asaasEventId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_asaasId_key" ON "BillingInvoice"("asaasId");

-- CreateIndex
CREATE INDEX "BillingInvoice_organizationId_vencimento_idx" ON "BillingInvoice"("organizationId", "vencimento");

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
