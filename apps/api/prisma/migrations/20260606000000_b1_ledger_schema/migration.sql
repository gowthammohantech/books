-- Account: currency + role protection
ALTER TABLE "Account" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "Account" ADD COLUMN "roleProtected" BOOLEAN NOT NULL DEFAULT false;

-- JournalEntry: source-link / idempotency / reversal / period / posting date
ALTER TABLE "JournalEntry" ADD COLUMN "postingDate" TIMESTAMP(3);
ALTER TABLE "JournalEntry" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "event" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "isSystemGenerated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JournalEntry" ADD COLUMN "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JournalEntry" ADD COLUMN "reversedById" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "periodId" TEXT;

-- JournalLine: currency-aware columns + tax-role tag
ALTER TABLE "JournalLine" ADD COLUMN "currencyCode" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "JournalLine" ADD COLUMN "baseDebit" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "JournalLine" ADD COLUMN "baseCredit" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "JournalLine" ADD COLUMN "taxRoleKey" TEXT;

-- Inventory: weighted-average cost
ALTER TABLE "Inventory" ADD COLUMN "avgCost" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "Inventory" ADD COLUMN "quantityOnHand" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CompanySettings: ledger-init
ALTER TABLE "CompanySettings" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "functionalCurrency" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "fiscalYearStartMonth" INTEGER;
ALTER TABLE "CompanySettings" ADD COLUMN "goLiveDate" TIMESTAMP(3);
ALTER TABLE "CompanySettings" ADD COLUMN "ledgerInitialized" BOOLEAN NOT NULL DEFAULT false;

-- LedgerAccountMapping
CREATE TABLE "LedgerAccountMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerAccountMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerAccountMapping_userId_roleKey_key" ON "LedgerAccountMapping"("userId", "roleKey");
CREATE INDEX "LedgerAccountMapping_userId_idx" ON "LedgerAccountMapping"("userId");

-- Unique index for journal entry idempotency (DB-level dedup backstop)
CREATE UNIQUE INDEX "JournalEntry_userId_sourceType_sourceId_event_key"
    ON "JournalEntry"("userId", "sourceType", "sourceId", "event");

-- Foreign keys
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversedById_fkey"
    FOREIGN KEY ("reversedById") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerAccountMapping" ADD CONSTRAINT "LedgerAccountMapping_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerAccountMapping" ADD CONSTRAINT "LedgerAccountMapping_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
