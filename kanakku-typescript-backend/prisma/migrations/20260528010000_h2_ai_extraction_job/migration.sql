-- Cluster H, slice H.2: AiExtractionJob + AiExtractionStatus enum

-- CreateEnum
CREATE TYPE "AiExtractionStatus" AS ENUM ('PENDING', 'EXTRACTED', 'CONFIRMED', 'FAILED', 'DISCARDED');

-- CreateTable
CREATE TABLE "AiExtractionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceFilePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" "AiExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractedData" JSONB,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    "confidence" DECIMAL(4,3),
    "resultingPurchaseId" TEXT,
    "costUsd" DECIMAL(10,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiExtractionJob_resultingPurchaseId_key" ON "AiExtractionJob"("resultingPurchaseId");

-- CreateIndex
CREATE INDEX "AiExtractionJob_userId_status_idx" ON "AiExtractionJob"("userId", "status");

-- AddForeignKey
ALTER TABLE "AiExtractionJob" ADD CONSTRAINT "AiExtractionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExtractionJob" ADD CONSTRAINT "AiExtractionJob_resultingPurchaseId_fkey" FOREIGN KEY ("resultingPurchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
