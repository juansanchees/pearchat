-- Equipe: papéis, espaços por atendente, convites, responsável pela conversa, autoria das mensagens e auditoria.
-- 100% ADITIVA: colunas nulas/com DEFAULT e tabelas novas. Backfill idempotente.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "desativadoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "assigneeId" TEXT,
ADD COLUMN "assignedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "senderUserId" TEXT;

-- CreateTable
CREATE TABLE "SpaceMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "workspaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "convidadoPorId" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "aceitoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "acao" TEXT NOT NULL,
    "alvo" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_assigneeId_idx" ON "Conversation"("workspaceId", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMember_userId_workspaceId_key" ON "SpaceMember"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "SpaceMember_workspaceId_idx" ON "SpaceMember"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_organizationId_aceitoEm_revogadoEm_idx" ON "Invite"("organizationId", "aceitoEm", "revogadoEm");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_convidadoPorId_fkey" FOREIGN KEY ("convidadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (idempotente): todo usuário existente tem papel; quem não tinha vira dono (comportamento anterior).
UPDATE "User" SET "papel" = 'owner' WHERE "papel" IS NULL OR "papel" = '';
