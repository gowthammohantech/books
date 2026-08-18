-- System-generated reversal rows must be payment-born (their cash movement is
-- already booked by the void/deletion GL; banking must never explain/repost
-- them). Create-sites now stamp the flag, but historical rows need repair:
--
-- 1. Expense-deletion reversals are created UNEXPLAINED, so the original
--    backfill's rule 1 (EXPLAINED-only) missed them and its rule 4 wrongly
--    swept them to MANUAL as "stuck bug victims".
-- 2. Invoice/supplier void reversals are created EXPLAINED (rule 2 caught
--    those), but any that a user un-explained through the old lock/unlock UI
--    were likewise swept to MANUAL.
--
-- Re-flag by their system remarks (best effort: rows whose remarks were
-- customised at void time are not identifiable). relatedType is restored for
-- rows the sweep already cleared; relatedId is not recoverable from SQL and
-- stays as-is.
UPDATE "BankTransaction"
SET "isPaymentBorn" = true, "relatedType" = 'EXPENSE'
WHERE "explainStatus" = 'UNEXPLAINED'
  AND "remarks" LIKE 'Reversal of deleted expense %';

UPDATE "BankTransaction"
SET "isPaymentBorn" = true, "relatedType" = 'INVOICE_PAYMENT'
WHERE "explainStatus" = 'UNEXPLAINED'
  AND "remarks" LIKE 'Void of invoice payment %';

UPDATE "BankTransaction"
SET "isPaymentBorn" = true, "relatedType" = 'SUPPLIER_PAYMENT'
WHERE "explainStatus" = 'UNEXPLAINED'
  AND "remarks" LIKE 'Void of supplier payment %';
