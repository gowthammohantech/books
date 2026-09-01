-- A1: Per-bank GL sub-account.
-- Give every BankDetail its own child Account under the tenant's BANK control
-- account so each bank reconciles independently against the ledger. The new
-- accounts are EMPTY (no journal lines, no balances) — postings start using
-- them in a later task, so the BANK parent rollup is unchanged by this migration.
--
-- Re-runnable: column/constraint creation is guarded with IF NOT EXISTS and the
-- backfill only touches BankDetail rows where accountId IS NULL.

-- 1. Column + FK ------------------------------------------------------------

ALTER TABLE "BankDetail" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BankDetail_accountId_fkey'
  ) THEN
    ALTER TABLE "BankDetail"
      ADD CONSTRAINT "BankDetail_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "BankDetail_accountId_idx" ON "BankDetail"("accountId");

-- 2. Backfill: one child Account per BankDetail, under the tenant's BANK parent.
--    Guarded on accountId IS NULL so a re-run skips already-linked banks.

DO $$
DECLARE
  bank        RECORD;
  parent_id   TEXT;
  parent_code TEXT;
  parent_type "AccountType";
  new_id      TEXT;
  new_code    TEXT;
  seq         INTEGER;
BEGIN
  FOR bank IN
    SELECT bd."id" AS bank_id, bd."userId" AS user_id, bd."bankName", bd."accountNumber"
    FROM "BankDetail" bd
    WHERE bd."accountId" IS NULL
    ORDER BY bd."userId", bd."createdAt", bd."id"
  LOOP
    -- Resolve this tenant's BANK control account via the role mapping.
    SELECT a."id", a."code", a."accountType"
      INTO parent_id, parent_code, parent_type
    FROM "LedgerAccountMapping" lam
    JOIN "Account" a ON a."id" = lam."accountId"
    WHERE lam."userId" = bank.user_id
      AND lam."roleKey" = 'BANK'
    LIMIT 1;

    -- No BANK mapping for this tenant: leave accountId NULL. Postings will fall
    -- back to the shared BANK role account (which also does not exist for such a
    -- tenant, so this tenant has no ledger configured at all — nothing to link).
    IF parent_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Generate a non-colliding child code: <parentcode>-<n>, where n is the
    -- smallest positive integer whose code is not yet taken for this tenant.
    seq := 1;
    LOOP
      new_code := parent_code || '-' || seq::text;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "Account"
        WHERE "userId" = bank.user_id AND "code" = new_code
      );
      seq := seq + 1;
    END LOOP;

    new_id := gen_random_uuid()::text;

    INSERT INTO "Account" (
      "id", "userId", "code", "name", "accountType", "parentId",
      "description", "currencyCode", "roleProtected", "isDeleted",
      "createdAt", "updatedAt"
    ) VALUES (
      new_id,
      bank.user_id,
      new_code,
      -- Human label = the bank name; account number kept for uniqueness/clarity.
      COALESCE(NULLIF(bank."bankName", ''), 'Bank Account')
        || ' - ' || bank."accountNumber",
      parent_type,          -- same type as the BANK parent (ASSET)
      parent_id,            -- nest under the BANK control account
      'Per-bank GL sub-account (auto-created for reconciliation)',
      NULL,
      false,                -- not role-protected (it is a leaf bank account)
      false,
      now(),
      now()
    );

    UPDATE "BankDetail" SET "accountId" = new_id WHERE "id" = bank.bank_id;
  END LOOP;
END
$$;
