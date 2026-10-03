-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "disparosSilencioAtivo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "disparosSilencioInicio" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN "disparosSilencioFim" INTEGER NOT NULL DEFAULT 8;
