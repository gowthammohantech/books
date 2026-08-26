-- Backfill: payment-born bank transactions (relatedType set and != MANUAL) are
-- already linked to a posted source document, but legacy rows were born
-- explainStatus='UNEXPLAINED'. Flip them to EXPLAINED and stamp the posted-source
-- pointer where it is derivable in pure SQL from relatedType/relatedId.
--
-- This migration creates NO journal entries and NO sub-documents. It is a pure
-- status/pointer backfill. The WHERE clauses all guard on explainStatus =
-- 'UNEXPLAINED', so re-running is idempotent (already-EXPLAINED rows are skipped).
--
-- relatedType -> JournalEntry.sourceType mapping (matches lib/moneyFlow/explainPosting.ts
-- postedSourceType assignments and the unexplain() branches keyed on these literals):
--   INVOICE_PAYMENT  -> 'InvoicePayment', postedSourceId = relatedId
--   SUPPLIER_PAYMENT -> 'SupplierPayment', postedSourceId = relatedId
--   EXPENSE          -> 'Expense',         postedSourceId = relatedId
--   PETTYCASH        -> no JE posted (per A3) -> leave postedSource null, isReconciled=false
--
-- CAUTION on reconciled: petty-cash payment-born txns post NO journal entry, so we
-- must NOT claim them reconciled. Inline-purchase rows are emitted as SUPPLIER_PAYMENT
-- and are indistinguishable in SQL from real supplier payments; those are marked
-- reconciled along with genuine supplier payments (accepted limitation — noted).

-- 1. INVOICE_PAYMENT: explained + reconciled, posted source = InvoicePayment.
UPDATE "BankTransaction"
SET "explainStatus" = 'EXPLAINED',
    "isReconciled" = true,
    "postedSourceType" = 'InvoicePayment',
    "postedSourceId" = "relatedId"
WHERE "relatedType" = 'INVOICE_PAYMENT'
  AND "explainStatus" = 'UNEXPLAINED';

-- 2. SUPPLIER_PAYMENT: explained + reconciled, posted source = SupplierPayment.
UPDATE "BankTransaction"
SET "explainStatus" = 'EXPLAINED',
    "isReconciled" = true,
    "postedSourceType" = 'SupplierPayment',
    "postedSourceId" = "relatedId"
WHERE "relatedType" = 'SUPPLIER_PAYMENT'
  AND "explainStatus" = 'UNEXPLAINED';

-- 3. EXPENSE: explained + reconciled, posted source = Expense.
UPDATE "BankTransaction"
SET "explainStatus" = 'EXPLAINED',
    "isReconciled" = true,
    "postedSourceType" = 'Expense',
    "postedSourceId" = "relatedId"
WHERE "relatedType" = 'EXPENSE'
  AND "explainStatus" = 'UNEXPLAINED';

-- 4. PETTYCASH: explained ONLY. No JE was posted (A3), so do NOT mark reconciled and
--    leave postedSource null. The link still surfaces via relatedType/relatedId.
UPDATE "BankTransaction"
SET "explainStatus" = 'EXPLAINED',
    "isReconciled" = false
WHERE "relatedType" = 'PETTYCASH'
  AND "explainStatus" = 'UNEXPLAINED';

-- 5. Any other non-MANUAL relatedType not covered above (defensive): mark EXPLAINED
--    but leave reconciled/postedSource untouched (status only; link via relatedType/Id).
UPDATE "BankTransaction"
SET "explainStatus" = 'EXPLAINED'
WHERE "relatedType" IS NOT NULL
  AND "relatedType" <> 'MANUAL'
  AND "relatedType" NOT IN ('INVOICE_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE', 'PETTYCASH')
  AND "explainStatus" = 'UNEXPLAINED';
