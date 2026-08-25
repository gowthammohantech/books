-- P0-2a: tenant scoping for PettyCash. Prior to this migration PettyCash was
-- an unscoped singleton (application code called `findFirst({})` with no
-- `where` at all), so every tenant on a multi-tenant install shared/leaked
-- the same petty-cash balance and transaction history. This adds an owning
-- `userId` and backfills it for every existing row using, in order:
--   1) the earliest BANK-relatedType PettyCashTransaction -> BankTransaction
--      -> BankDetail.userId chain (the bank account that funded it);
--   2) the earliest EXPENSE-relatedType PettyCashTransaction -> Expense.userId
--      chain (the expense it paid out to);
--   3) the earliest SUPPLIER_PAYMENT-relatedType PettyCashTransaction ->
--      SupplierPayment -> Purchase.userId chain (the purchase it paid);
--   4) FINAL FALLBACK: the install's primary admin user (earliest-created
--      user_type = 1 account, or if none exists, the earliest-created user
--      overall). PettyCash was a global singleton before this migration, so
--      assigning any still-unresolved row to the primary admin matches prior
--      single-org semantics exactly (that admin already saw/owned it).
--
-- After this migration no PettyCash row is left with userId = NULL.
-- Application code (see pettyCashWhere()/controllers/pettyCashController.ts)
-- reads/writes with a strict `{ userId }` match — no OR-null fallback — so
-- rows are never shared across tenants, before or after this migration.
-- The column stays nullable at the schema level (a future row created by
-- code that doesn't stamp userId would violate an app invariant, not a DB
-- one), but every row that exists as of this migration is guaranteed to
-- carry a concrete owner.

-- AlterTable
ALTER TABLE "PettyCash" ADD COLUMN "userId" TEXT;

-- Backfill (1): derive the owning tenant from the earliest BANK-funded
-- PettyCashTransaction on each PettyCash row, if one exists.
UPDATE "PettyCash" pc
SET "userId" = sub."userId"
FROM (
  SELECT DISTINCT ON (pct."pettyCashId")
    pct."pettyCashId" AS "pettyCashId",
    bd."userId" AS "userId"
  FROM "PettyCashTransaction" pct
  JOIN "BankTransaction" bt ON bt.id = pct."relatedId"
  JOIN "BankDetail" bd ON bd.id = bt."bankAccountId"
  WHERE pct."relatedType" = 'BANK'
  ORDER BY pct."pettyCashId", pct."transactionDate" ASC
) sub
WHERE pc.id = sub."pettyCashId";

-- Backfill (2): for rows still unresolved, derive ownership from the
-- earliest EXPENSE-relatedType PettyCashTransaction on that row.
UPDATE "PettyCash" pc
SET "userId" = sub."userId"
FROM (
  SELECT DISTINCT ON (pct."pettyCashId")
    pct."pettyCashId" AS "pettyCashId",
    e."userId" AS "userId"
  FROM "PettyCashTransaction" pct
  JOIN "Expense" e ON e.id = pct."relatedId"
  WHERE pct."relatedType" = 'EXPENSE'
  ORDER BY pct."pettyCashId", pct."transactionDate" ASC
) sub
WHERE pc.id = sub."pettyCashId"
  AND pc."userId" IS NULL;

-- Backfill (3): for rows still unresolved, derive ownership from the
-- earliest SUPPLIER_PAYMENT-relatedType PettyCashTransaction on that row,
-- via the SupplierPayment's Purchase (SupplierPayment.createdBy is
-- nullable; Purchase.userId is not, so it's the reliable join here).
UPDATE "PettyCash" pc
SET "userId" = sub."userId"
FROM (
  SELECT DISTINCT ON (pct."pettyCashId")
    pct."pettyCashId" AS "pettyCashId",
    p."userId" AS "userId"
  FROM "PettyCashTransaction" pct
  JOIN "SupplierPayment" sp ON sp.id = pct."relatedId"
  JOIN "Purchase" p ON p.id = sp."purchaseId"
  WHERE pct."relatedType" = 'SUPPLIER_PAYMENT'
  ORDER BY pct."pettyCashId", pct."transactionDate" ASC
) sub
WHERE pc.id = sub."pettyCashId"
  AND pc."userId" IS NULL;

-- Backfill (4) FINAL FALLBACK: any row still unresolved (never funded via a
-- bank transfer, expense, or supplier payment we can trace) is assigned to
-- the install's primary admin user — the earliest-created user_type = 1
-- account, or the earliest-created user overall if no admin row exists.
UPDATE "PettyCash" pc
SET "userId" = (
  SELECT u.id
  FROM "User" u
  WHERE u."isDeleted" = false
  ORDER BY
    CASE WHEN u.user_type = 1 THEN 0 ELSE 1 END,
    u."createdAt" ASC
  LIMIT 1
)
WHERE pc."userId" IS NULL;

-- CreateIndex
CREATE INDEX "PettyCash_userId_idx" ON "PettyCash"("userId");

-- AddForeignKey
ALTER TABLE "PettyCash" ADD CONSTRAINT "PettyCash_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
