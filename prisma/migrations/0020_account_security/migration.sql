-- Endurecimento de conta (onda 1): 100% ADITIVA (colunas com DEFAULT e um índice).

-- AlterTable: o convite chegou ao e-mail do convidado (link NÃO exposto a quem convidou)? Só então o aceite prova a posse do e-mail.
ALTER TABLE "Invite" ADD COLUMN "emailEntregue" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: confirmação no WhatsApp disparada pelo agendamento do link (0 = nenhuma, 1 = contato existente, 2 = número novo): teto por negócio.
ALTER TABLE "BookingAttempt" ADD COLUMN "confirmacaoWa" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "BookingAttempt_workspaceId_createdAt_idx" ON "BookingAttempt"("workspaceId", "createdAt");
