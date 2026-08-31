CREATE TYPE "CategoryGroup" AS ENUM ('ADMIN_EXPENSES','GENERAL_OVERHEADS','COST_OF_SALES','PAYROLL','TAXES','INCOME','CAPITAL','OWNER_FUNDS','USER_PAYMENTS');
CREATE TYPE "CategoryAppliesTo" AS ENUM ('MONEY_IN','MONEY_OUT','MONEY_IN_USER','MONEY_OUT_USER');
CREATE TYPE "ExplainStatus" AS ENUM ('UNEXPLAINED','FOR_APPROVAL','EXPLAINED');

CREATE TABLE "TransactionCategory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "group" "CategoryGroup" NOT NULL,
  "appliesTo" "CategoryAppliesTo" NOT NULL,
  "accountId" TEXT NOT NULL,
  "defaultTaxRateId" TEXT,
  "taxApplicable" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "status" BOOLEAN NOT NULL DEFAULT true,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransactionCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TransactionCategory_userId_code_key" ON "TransactionCategory"("userId","code");
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "TaxRate"("id") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "BankTransaction"
  ADD COLUMN "explainStatus" "ExplainStatus" NOT NULL DEFAULT 'UNEXPLAINED',
  ADD COLUMN "transactionTypeKey" TEXT,
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "payToUserId" TEXT,
  ADD COLUMN "taxTreatment" TEXT,
  ADD COLUMN "taxAmount" DECIMAL(18,4),
  ADD COLUMN "explainedDescription" TEXT,
  ADD COLUMN "attachment" TEXT,
  ADD COLUMN "assetType" TEXT,
  ADD COLUMN "depreciationMethod" TEXT,
  ADD COLUMN "assetLifeMonths" INTEGER,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "postedSourceType" TEXT,
  ADD COLUMN "postedSourceId" TEXT;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE "Expense"
  ADD COLUMN "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxRateId" TEXT;
