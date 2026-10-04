-- Mídia e áudio nas conversas (Etapa 1). Somente colunas novas e anuláveis (ou com padrão): aditiva e segura em produção.
ALTER TABLE "Message" ADD COLUMN "mediaType" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaMime" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaSize" INTEGER;
ALTER TABLE "Message" ADD COLUMN "mediaName" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaKey" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaDurationSec" INTEGER;
ALTER TABLE "Message" ADD COLUMN "transcript" TEXT;
ALTER TABLE "Message" ADD COLUMN "transcriptStatus" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaStatus" TEXT;

ALTER TABLE "UsageCounter" ADD COLUMN "transcricoesSeg" INTEGER NOT NULL DEFAULT 0;
