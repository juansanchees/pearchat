-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "nextSendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN "repliedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FollowUpJob" ADD COLUMN "error" TEXT;

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventReminder" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT,

    CONSTRAINT "EventReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiJob_status_runAt_idx" ON "AiJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "AiJob_conversationId_status_idx" ON "AiJob"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventReminder_eventId_kind_key" ON "EventReminder"("eventId", "kind");

-- CreateIndex
CREATE INDEX "FollowUpJob_conversationId_status_idx" ON "FollowUpJob"("conversationId", "status");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminder" ADD CONSTRAINT "EventReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
