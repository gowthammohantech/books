-- #61: Backfill currencyCode on legacy Purchase rows.
--
-- Purchases converted from a Purchase Order before the forward fix were stored
-- with currencyCode = NULL, so the display layer fell back to the base currency
-- (₹). Set those NULL values to the owning tenant's default currency code.
--
-- The tenant is Purchase.userId; the per-tenant default currency is the Currency
-- row owned by that user (Currency.createdBy) with isDefault = true. We require a
-- single unambiguous, non-deleted match (LIMIT 1 on a stable ordering) and only
-- touch rows where such a default exists.
--
-- Idempotent: the WHERE clause guards on currencyCode IS NULL, so already-set
-- rows (including those written by the forward fix) are skipped on re-run.

UPDATE "Purchase" AS p
SET "currencyCode" = (
  SELECT c."code"
  FROM "Currency" AS c
  WHERE c."createdBy" = p."userId"
    AND c."isDefault" = true
    AND (c."isDeleted" IS NULL OR c."isDeleted" = false)
  ORDER BY c."createdAt" ASC
  LIMIT 1
)
WHERE p."currencyCode" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "Currency" AS c
    WHERE c."createdBy" = p."userId"
      AND c."isDefault" = true
      AND (c."isDeleted" IS NULL OR c."isDeleted" = false)
  );
