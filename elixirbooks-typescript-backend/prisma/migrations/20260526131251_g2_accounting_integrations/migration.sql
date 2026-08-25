CREATE TYPE "IntegrationKind" AS ENUM ('XERO', 'QUICKBOOKS');

CREATE TABLE "AccountingIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingIntegration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingIntegration_userId_kind_key" ON "AccountingIntegration"("userId", "kind");
ALTER TABLE "AccountingIntegration" ADD CONSTRAINT "AccountingIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
