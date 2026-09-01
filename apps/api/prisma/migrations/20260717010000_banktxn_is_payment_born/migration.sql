-- Add the payment-born discriminator.
ALTER TABLE "BankTransaction" ADD COLUMN "isPaymentBorn" BOOLEAN NOT NULL DEFAULT false;

-- Backfill 1: PETTYCASH / EXPENSE relatedTypes are only ever created by module
-- flows (banking explain never sets them) → payment-born.
UPDATE "BankTransaction"
SET "isPaymentBorn" = true
WHERE "relatedType" IN ('PETTYCASH', 'EXPENSE')
  AND "explainStatus" = 'EXPLAINED';

-- Backfill 2: INVOICE_PAYMENT / SUPPLIER_PAYMENT rows are ambiguous. Module
-- creation (explainedBankFields spread) never stamps transactionTypeKey;
-- banking explain (explainAndPost) always does. NULL key → module-born.
UPDATE "BankTransaction"
SET "isPaymentBorn" = true
WHERE "relatedType" IN ('INVOICE_PAYMENT', 'SUPPLIER_PAYMENT')
  AND "explainStatus" = 'EXPLAINED'
  AND "transactionTypeKey" IS NULL;

-- Backfill 3: un-stick the bug victims. An UNEXPLAINED row with a non-MANUAL
-- relatedType was banking-explained as a payment and then unexplained (the old
-- unexplain retained relatedType, permanently locking the row). Its payment
-- artefacts were already voided by that unexplain; clear the stale linkage.
UPDATE "BankTransaction"
SET "relatedType" = 'MANUAL', "relatedId" = NULL
WHERE "explainStatus" = 'UNEXPLAINED'
  AND "relatedType" IS NOT NULL
  AND "relatedType" <> 'MANUAL';
