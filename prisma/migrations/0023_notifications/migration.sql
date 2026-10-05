-- Notificações (sininho): histórico por usuário e por espaço (derivado do que já está gravado) e o cursor da sincronização.
-- 100% ADITIVA: só tabelas e índices novos; nada existente é alterado.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT,
    "contagem" INTEGER NOT NULL DEFAULT 1,
    "link" TEXT,
    "refIds" JSONB,
    "dados" JSONB,
    "ausente" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "lidaEm" TIMESTAMP(3),
    "apagadaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCursor" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sincronizadoAte" TIMESTAMP(3) NOT NULL,
    "ultimaAtividadeEm" TIMESTAMP(3) NOT NULL,
    "estado" JSONB,

    CONSTRAINT "NotificationCursor_pkey" PRIMARY KEY ("userId","workspaceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_workspaceId_dedupeKey_key" ON "Notification"("userId", "workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_workspaceId_createdAt_idx" ON "Notification"("userId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationCursor_workspaceId_idx" ON "NotificationCursor"("workspaceId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCursor" ADD CONSTRAINT "NotificationCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCursor" ADD CONSTRAINT "NotificationCursor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
