-- Robustez do caminho da mensagem (onda 1). Só ADITIVA e retrocompatível com o código anterior:
-- tabela nova, colunas anuláveis e índices. Nada é apagado nem reescrito.

-- Caixa de entrada durável dos webhooks (Evolution e Meta).
CREATE TABLE IF NOT EXISTS "WebhookInbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookInbox_provider_dedupeKey_key" ON "WebhookInbox"("provider", "dedupeKey");
CREATE INDEX IF NOT EXISTS "WebhookInbox_processedAt_nextAttemptAt_idx" ON "WebhookInbox"("processedAt", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "WebhookInbox_receivedAt_idx" ON "WebhookInbox"("receivedAt");

-- Envio: chave de idempotência por job e estado "incerto" (o provedor pode ter aceitado sem confirmar).
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "sendKey" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "uncertainSince" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Message_conversationId_sendKey_key" ON "Message"("conversationId", "sendKey");

-- Caminhos quentes: dedupe/atualização de status por id do provedor (até 3 por mensagem enviada), reconciliação de
-- envios pendentes e busca da sessão da Evolution a cada webhook.
CREATE INDEX IF NOT EXISTS "Message_providerMessageId_idx" ON "Message"("providerMessageId");
CREATE INDEX IF NOT EXISTS "Message_status_createdAt_idx" ON "Message"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppSession_evolutionInstance_idx" ON "WhatsAppSession"("evolutionInstance");
