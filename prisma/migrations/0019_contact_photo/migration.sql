-- Foto do WhatsApp dos contatos. 100% ADITIVA: duas colunas nulas, sem DEFAULT e sem reescrita de tabela.
-- photoUrl: caminho interno da rota autenticada (/api/contact-photo/<id>); a URL do WhatsApp nunca e guardada.
-- photoCheckedAt: ultima verificacao no provedor (revalida no maximo a cada 7 dias).

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "photoUrl" TEXT,
ADD COLUMN "photoCheckedAt" TIMESTAMP(3);
