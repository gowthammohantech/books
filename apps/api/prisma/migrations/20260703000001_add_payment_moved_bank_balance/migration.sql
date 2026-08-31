-- Finding 1 refix: a persisted, unambiguous signal for "did this payment's
-- CREATE path move a cash register?", so delete/void reverses the register
-- exactly once.
--
-- WHY a flag (not a bank-line lookup): the bank-reconciliation EXPLAIN flow
-- (lib/moneyFlow/explainPosting.ts) RELABELS the pre-existing imported statement
-- line, stamping relatedType=INVOICE_PAYMENT/SUPPLIER_PAYMENT + relatedId=<paymentId>
-- + postedSourceType onto it (explainPosting.ts ~L775). The record path
-- (recordInvoicePayment / createSupplierPayment) writes its OWN fresh bank line
-- with the very same relatedType/relatedId/postedSourceType (auto-explain). So a
-- "does a bank line keyed to this payment exist?" test matches BOTH origins and
-- cannot discriminate. This explicit column can.

ALTER TABLE "InvoicePayment"  ADD COLUMN "movedBankBalance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SupplierPayment" ADD COLUMN "movedBankBalance" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing rows.
--
-- A payment moved a cash register at create IFF it AUTHORED its own cash line in
-- the SAME transaction it was created in. The record path INSERTs the
-- BankTransaction / PettyCashTransaction inside the payment's own $transaction,
-- so Postgres now() (which is the transaction-start clock, constant within a
-- transaction) makes the cash line's createdAt EQUAL the payment's createdAt.
-- The explain flow relabels a PRE-EXISTING imported line whose createdAt was
-- stamped in an EARLIER import transaction, so it is strictly < the payment's
-- createdAt. Hence "cash line exists with createdAt >= payment.createdAt"
-- selects record-path payments (equal) and rejects explain-relabels (earlier).
--
-- Cash-in-hand invoice receipts (no bank) and any payment with no self-authored
-- cash line correctly stay FALSE — nothing to reverse on the register.

UPDATE "InvoicePayment" ip
SET "movedBankBalance" = true
WHERE EXISTS (
  SELECT 1 FROM "BankTransaction" bt
  WHERE bt."relatedType" = 'INVOICE_PAYMENT'
    AND bt."relatedId"   = ip."id"
    AND bt."createdAt"  >= ip."createdAt"
);

UPDATE "SupplierPayment" sp
SET "movedBankBalance" = true
WHERE EXISTS (
  SELECT 1 FROM "BankTransaction" bt
  WHERE bt."relatedType" = 'SUPPLIER_PAYMENT'
    AND bt."relatedId"   = sp."id"
    AND bt."createdAt"  >= sp."createdAt"
)
OR EXISTS (
  SELECT 1 FROM "PettyCashTransaction" pct
  WHERE pct."relatedType" = 'SUPPLIER_PAYMENT'
    AND pct."relatedId"   = sp."id"
    AND pct."createdAt"  >= sp."createdAt"
);
