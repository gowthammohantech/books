-- Banking Phase B / B2: proposal columns on BankTransaction.
-- The auto-matcher (lib/moneyFlow/autoMatch.ts) writes its best proposed
-- explanation here so a later approve can feed it straight into explainAndPost.
ALTER TABLE "BankTransaction" ADD COLUMN "proposedRelatedType" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "proposedRelatedId" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "matchConfidence" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "matchScore" INTEGER;
ALTER TABLE "BankTransaction" ADD COLUMN "proposedTransactionTypeKey" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "proposedCategoryId" TEXT;
