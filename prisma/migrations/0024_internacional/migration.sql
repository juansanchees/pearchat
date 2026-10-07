-- Clientes de outros países: DDI padrão e fuso horário por espaço (WhatsApp).
-- 100% ADITIVA: duas colunas novas com DEFAULT constante (Postgres 11+ não reescreve a tabela). Quem já existe fica com
-- 55 e America/Sao_Paulo, exatamente o comportamento de antes; o código antigo ignora as colunas.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "ddiPadrao" TEXT NOT NULL DEFAULT '55',
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
