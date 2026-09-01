-- Cluster H, slice H.1: AiConfig + AiProviderKind enum

-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('CLAUDE', 'OPENAI', 'MOCK');

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AiProviderKind" NOT NULL DEFAULT 'MOCK',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "encryptedApiKey" TEXT,
    "apiKeyHint" TEXT,
    "extractionModel" TEXT,
    "chatModel" TEXT,
    "monthlyBudgetUsd" DECIMAL(10,2) DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConfig_userId_key" ON "AiConfig"("userId");

-- AddForeignKey
ALTER TABLE "AiConfig" ADD CONSTRAINT "AiConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
