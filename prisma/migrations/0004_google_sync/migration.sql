-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN "syncTokens" JSONB,
ADD COLUMN "ultimaSyncEm" TIMESTAMP(3),
ADD COLUMN "syncTentadaEm" TIMESTAMP(3),
ADD COLUMN "precisaReconectar" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "googleCalendarId" TEXT;

-- CreateTable
CREATE TABLE "CalendarOAuthState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarOAuthState_expiraEm_idx" ON "CalendarOAuthState"("expiraEm");
